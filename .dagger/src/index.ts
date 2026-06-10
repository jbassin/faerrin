/**
 * CI module for the Faerrin monorepo.
 *
 * Reproduces the GitHub Actions CI pipeline as a Dagger TypeScript module so the
 * exact same steps run locally (`dagger call check` / `dagger call build`) and in
 * CI — no local-vs-CI drift. Everything runs inside a pinned oven/bun:1.3.14
 * container, matching the bun version the workflow used to install via setup-bun.
 */
import { dag, Container, Directory, object, func } from "@dagger.io/dagger"

@object()
export class Ci {
  /**
   * Base container: oven/bun pinned to the CI bun version, source mounted, deps
   * installed from the frozen lockfile. A persistent cache volume holds bun's
   * download cache so installs are fast on warm runs. Lazy — nothing executes
   * until a leaf (`.stdout()`) is awaited.
   */
  private base(source: Directory): Container {
    return dag
      .container()
      .from("oven/bun:1.3.14")
      .withEnvVariable("BUN_INSTALL_CACHE_DIR", "/bun-cache")
      .withMountedCache("/bun-cache", dag.cacheVolume("faerrin-bun-cache"))
      .withMountedDirectory("/src", source)
      .withWorkdir("/src")
      .withExec(["bun", "install", "--frozen-lockfile"])
  }

  /** Typecheck every app (`bun --filter '*' typecheck`). */
  @func()
  async typecheck(source: Directory): Promise<string> {
    return this.base(source).withExec(["bun", "--filter", "*", "typecheck"]).stdout()
  }

  /** Astro check for aether and face (`bun --filter '*' check`). */
  @func()
  async astroCheck(source: Directory): Promise<string> {
    return this.base(source).withExec(["bun", "--filter", "*", "check"]).stdout()
  }

  /** Lint (`bun --filter '*' lint`). */
  @func()
  async lint(source: Directory): Promise<string> {
    return this.base(source).withExec(["bun", "--filter", "*", "lint"]).stdout()
  }

  /** Test every app (`bun --filter '*' test`). */
  @func()
  async test(source: Directory): Promise<string> {
    return this.base(source).withExec(["bun", "--filter", "*", "test"]).stdout()
  }

  /**
   * The `check` CI job: typecheck → astro check → lint → test, in order and
   * fail-fast — a non-zero step makes `.stdout()` throw and aborts the rest,
   * exactly like the sequential GitHub-Actions steps did. Returns combined logs.
   */
  @func()
  async check(source: Directory): Promise<string> {
    const steps: Array<[string, string[]]> = [
      ["Typecheck", ["bun", "--filter", "*", "typecheck"]],
      ["Astro check", ["bun", "--filter", "*", "check"]],
      ["Lint", ["bun", "--filter", "*", "lint"]],
      ["Test", ["bun", "--filter", "*", "test"]],
    ]
    let container = this.base(source)
    let output = ""
    for (const [label, cmd] of steps) {
      output += `\n=== ${label} ===\n`
      container = container.withExec(cmd)
      output += await container.stdout()
    }
    return output
  }

  /**
   * The `build` CI job: build every site (aether, strider, face).
   * strider's build renders an OG image via Playwright, so Chromium + its system
   * deps are installed via apt (needs root) into an explicit browsers path.
   * Everything runs as the oven/bun image's default user (root) — the same user
   * that ran `bun install`, so node_modules ownership stays consistent (a mixed
   * install-as-root / build-as-bun split fails with EACCES on vite's cache dirs).
   * Build output is deterministic site generation, so the user doesn't affect
   * aether's byte-identical result.
   */
  @func()
  async build(source: Directory): Promise<string> {
    return this.base(source)
      .withEnvVariable("PLAYWRIGHT_BROWSERS_PATH", "/ms-playwright")
      .withExec(["bunx", "playwright", "install", "--with-deps", "chromium"])
      .withExec(["bun", "--filter", "*", "build"])
      .stdout()
  }

  /**
   * Base container for vellum's PNG render: Chromium installed + vellum built
   * (the render service serves dist/). Shared by the VR compare/update funcs.
   */
  private vellumRenderBase(source: Directory): Container {
    return this.base(source)
      .withEnvVariable("PLAYWRIGHT_BROWSERS_PATH", "/ms-playwright")
      .withExec(["bunx", "playwright", "install", "--with-deps", "chromium"])
      .withExec(["bun", "--filter", "@faerrin/vellum", "build"])
  }

  /**
   * Golden-image visual regression for vellum (NFR-9). Renders the fixtures and
   * compares to the committed goldens with a perceptual tolerance — throws on
   * drift. Goldens are authoritative in THIS pinned container only.
   */
  @func()
  async visualRegression(source: Directory): Promise<string> {
    return this.vellumRenderBase(source)
      .withExec(["bun", "--filter", "@faerrin/vellum", "visual-regression"])
      .stdout()
  }

  /**
   * Regenerate vellum's goldens IN the pinned container and return them as a
   * Directory, e.g.:
   *   dagger call update-goldens --source=. export --path=pkg/vellum/test/visual/golden
   */
  @func()
  updateGoldens(source: Directory): Directory {
    return this.vellumRenderBase(source)
      .withExec([
        "bun",
        "--filter",
        "@faerrin/vellum",
        "visual-regression",
        "--",
        "--update",
      ])
      .directory("/src/pkg/vellum/test/visual/golden")
  }

  /** The full pipeline: `check` then `build`. */
  @func()
  async all(source: Directory): Promise<string> {
    const checkOutput = await this.check(source)
    const buildOutput = await this.build(source)
    return `${checkOutput}\n\n=== Build ===\n${buildOutput}`
  }

  /**
   * Base container for the Rust service `services/speaks` (the vendored Discord
   * bot). Pinned to clux/muslrust:nightly — the same image the bot's Dockerfile
   * uses, and nightly is required (the `roller` crate enables a nightly feature).
   * Kept ENTIRELY separate from the Bun lanes (`bun --filter '*'` never sees it):
   * a Rust failure must not block a static-site deploy, and vice versa. Cargo's
   * registry + the crate's target dir are cached so warm runs are fast.
   * SQLX_OFFLINE makes the sqlx macros validate against the committed `.sqlx/`
   * metadata instead of needing a live database.
   */
  private rustBase(source: Directory): Container {
    return dag
      .container()
      .from("clux/muslrust:nightly")
      .withEnvVariable("SQLX_OFFLINE", "true")
      .withMountedCache("/root/.cargo/registry", dag.cacheVolume("faerrin-cargo-registry"))
      .withMountedCache(
        "/src/services/speaks/target",
        dag.cacheVolume("faerrin-speaks-target"),
      )
      .withMountedDirectory("/src", source)
      .withWorkdir("/src/services/speaks")
  }

  /**
   * The Rust `check` job for `services/speaks`: format check → clippy → test, in
   * order and fail-fast. NOTE: clippy runs in report mode while the staged
   * migration is in flight — the bulk of the remaining dead-code warnings are the
   * identity fields/queries (`Profile`, `get_active_campaign`, `Campaign`) that
   * Phase 3 removes when identity moves to content. `clippy -- -D warnings`
   * becomes the hard gate after Phase 3. `roller` carries the real unit tests.
   */
  @func()
  async rustCheck(source: Directory): Promise<string> {
    const steps: Array<[string, string[]]> = [
      ["fmt", ["cargo", "fmt", "--check"]],
      ["clippy", ["cargo", "clippy", "--workspace"]],
      ["test", ["cargo", "test", "--workspace"]],
    ]
    let container = this.rustBase(source)
    let output = ""
    for (const [label, cmd] of steps) {
      output += `\n=== ${label} ===\n`
      container = container.withExec(cmd)
      output += await container.stdout()
    }
    return output
  }

  /** The Rust `build` job: the musl release binary the deploy unit runs. */
  @func()
  async rustBuild(source: Directory): Promise<string> {
    return this.rustBase(source)
      .withExec([
        "cargo",
        "build",
        "--release",
        "--target",
        "x86_64-unknown-linux-musl",
        "--bin",
        "discord",
      ])
      .stdout()
  }
}
