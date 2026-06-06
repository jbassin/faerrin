import { describe, expect, it } from "vitest";
import { appendAuthoredParagraph, commitMessage, newPageContent } from "./commit.ts";

describe("appendAuthoredParagraph (v1 amend strategy)", () => {
  it("appends as a new paragraph with a blank-line separator", () => {
    expect(appendAuthoredParagraph("Existing prose.", "New prose.")).toBe(
      "Existing prose.\n\nNew prose.\n",
    );
  });

  it("normalizes trailing whitespace before appending", () => {
    expect(appendAuthoredParagraph("Existing.\n\n\n", "Added.")).toBe("Existing.\n\nAdded.\n");
  });

  it("handles an empty body (no leading blank lines)", () => {
    expect(appendAuthoredParagraph("", "First.")).toBe("First.\n");
  });
});

describe("newPageContent", () => {
  it("is plain prose with a trailing newline (no frontmatter)", () => {
    expect(newPageContent("  A new page.  ")).toBe("A new page.\n");
  });
});

describe("commitMessage", () => {
  it("summarizes the tally (AC-18)", () => {
    expect(commitMessage("through-a-song-darkly", "2025-08-28", 2, 1)).toBe(
      "heartwood: through-a-song-darkly 2025-08-28 — 3 pages (2 amend, 1 create)",
    );
  });

  it("singularizes one page", () => {
    expect(commitMessage("arc", "2025-01-01", 1, 0)).toBe(
      "heartwood: arc 2025-01-01 — 1 page (1 amend, 0 create)",
    );
  });
});
