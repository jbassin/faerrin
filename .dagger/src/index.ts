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

  /** The full pipeline: `check` then `build`. */
  @func()
  async all(source: Directory): Promise<string> {
    const checkOutput = await this.check(source)
    const buildOutput = await this.build(source)
    return `${checkOutput}\n\n=== Build ===\n${buildOutput}`
  }
}
