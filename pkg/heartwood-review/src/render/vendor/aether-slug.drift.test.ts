import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Drift guard: the vendored aether-slug.ts must stay byte-identical to aether's
// live slug.ts (the byte-critical, Quartz-ported URL logic). If aether's file
// changes, this fails and prompts a re-vendor — preventing silent divergence,
// the one real risk of vendoring instead of importing.
const VENDORED = join(import.meta.dirname, "aether-slug.ts");
const AETHER = join(process.cwd(), "..", "aether", "src", "lib", "slug.ts");
const SENTINEL = "//<<<AETHER-SLUG-VERBATIM>>>\n";

describe.skipIf(!existsSync(AETHER))("aether-slug vendor drift", () => {
  it("vendored copy matches aether's slug.ts verbatim", () => {
    const vendored = readFileSync(VENDORED, "utf8");
    const verbatim = vendored.slice(
      vendored.indexOf(SENTINEL) + SENTINEL.length,
    );
    const original = readFileSync(AETHER, "utf8");
    expect(verbatim).toBe(original);
  });
});
