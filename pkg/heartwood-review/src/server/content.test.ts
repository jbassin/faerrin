import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { within } from "./paths.ts";

const ROOT = join("/tmp", "hwr-root");

describe("within (path-traversal guard, C1)", () => {
  it("allows a path inside the root", () => {
    expect(within(ROOT, "Geography/Calaria/index.md")).toBe(
      join(ROOT, "Geography/Calaria/index.md"),
    );
  });

  it("allows the root itself", () => {
    expect(within(ROOT, ".")).toBe(ROOT);
  });

  it("rejects ../ escapes", () => {
    expect(() => within(ROOT, "../../etc/passwd")).toThrow(/escapes/);
  });

  it("rejects absolute paths outside the root", () => {
    expect(() => within(ROOT, "/etc/passwd")).toThrow(/escapes/);
  });

  it("rejects a sibling-prefix sneak (root + suffix)", () => {
    // `${ROOT}-evil` shares the string prefix but is not under ROOT/.
    expect(() => within(ROOT, "../hwr-root-evil/x")).toThrow(/escapes/);
  });
});

// M2 guard: importing the core's review/identity path must NOT pull any Bun-only
// module at load time (this test runs under Node/vitest, where `Bun` is undefined).
describe("core review module loads under Node (no Bun import)", () => {
  it("imports state/review.ts and runs a pure fn without a Bun reference", async () => {
    const review = await import("@faerrin/heartwood/src/state/review.ts");
    const s = review.emptyReviewState({ arc: "x", date: "2025-01-01" });
    expect(review.reviewStatus(s, [])).toBe("reviewed");
    // identity.ts (transitively imported) parses a filename with no I/O.
    const identity = await import("@faerrin/heartwood/src/state/identity.ts");
    expect(identity.sessionIdFromFilename("000.arc.2025-1-2.txt")).toEqual({
      arc: "arc",
      date: "2025-01-02",
    });
  });
});
