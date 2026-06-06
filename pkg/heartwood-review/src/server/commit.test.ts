import { describe, expect, it } from "vitest";
import {
  appendAuthoredParagraph,
  applySupersede,
  applyWeave,
  commitMessage,
  newPageContent,
} from "./commit.ts";

describe("appendAuthoredParagraph (v1 amend strategy)", () => {
  it("appends as a new paragraph with a blank-line separator", () => {
    expect(appendAuthoredParagraph("Existing prose.", "New prose.")).toBe(
      "Existing prose.\n\nNew prose.\n",
    );
  });

  it("normalizes trailing whitespace before appending", () => {
    expect(appendAuthoredParagraph("Existing.\n\n\n", "Added.")).toBe(
      "Existing.\n\nAdded.\n",
    );
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

  it("includes a corrections clause when present (AC-21/AC-18)", () => {
    expect(commitMessage("arc", "2025-01-01", 1, 0, 2)).toBe(
      "heartwood: arc 2025-01-01 — 3 pages (1 amend, 0 create, 2 correct)",
    );
  });
});

describe("applySupersede (AC-21)", () => {
  it("replaces the existing statement in place when located verbatim", () => {
    const body = "Foo is calm. The city has six legs. Bar is loud.";
    const r = applySupersede(
      body,
      "The city has six legs.",
      "The city has four legs.",
    );
    expect(r.located).toBe(true);
    expect(r.body).toBe("Foo is calm. The city has four legs. Bar is loud.");
  });

  it("falls back to appending (never loses prose) when not found", () => {
    const r = applySupersede(
      "Existing prose.",
      "a statement not present",
      "New fact.",
    );
    expect(r.located).toBe(false);
    expect(r.body).toBe("Existing prose.\n\nNew fact.\n");
  });
});

describe("applyWeave (AC-12)", () => {
  const body = "First para about the docks.\n\nSecond para about the river.\n";

  it("end (default) appends a new paragraph", () => {
    const r = applyWeave(body, "A new note.");
    expect(r.mode).toBe("end");
    expect(r.body).toMatch(/Second para about the river\.\n\nA new note\.\n$/);
  });

  it("into merges the prose into the chosen paragraph", () => {
    const r = applyWeave(body, "It teems with gulls.", {
      mode: "into",
      anchorText: "First para about the docks.",
    });
    expect(r.mode).toBe("into");
    expect(r.body).toContain(
      "First para about the docks. It teems with gulls.",
    );
    expect(r.body).toContain("Second para about the river.");
  });

  it("after inserts a new paragraph following the chosen one", () => {
    const r = applyWeave(body, "An aside.", {
      mode: "after",
      anchorText: "First para about the docks.",
    });
    expect(r.body).toBe(
      "First para about the docks.\n\nAn aside.\n\nSecond para about the river.\n",
    );
  });

  it("falls back to end when the anchor paragraph is gone", () => {
    const r = applyWeave(body, "Lost prose.", {
      mode: "into",
      anchorText: "a paragraph not here",
    });
    expect(r.mode).toBe("end");
    expect(r.body).toMatch(/Lost prose\.\n$/);
  });
});
