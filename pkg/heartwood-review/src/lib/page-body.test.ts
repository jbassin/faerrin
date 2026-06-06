import { describe, expect, test } from "vitest";
import { replacePageBody, splitFrontmatter } from "./page-body.ts";

describe("splitFrontmatter", () => {
  test("splits a frontmatter block from the body", () => {
    const raw = "---\naliases: [Foo]\n---\nThe body starts here.\n";
    expect(splitFrontmatter(raw)).toEqual({
      frontmatter: "---\naliases: [Foo]\n---\n",
      body: "The body starts here.\n",
    });
  });

  test("no frontmatter → empty frontmatter, full body", () => {
    expect(splitFrontmatter("Just prose.\n")).toEqual({
      frontmatter: "",
      body: "Just prose.\n",
    });
  });
});

describe("replacePageBody", () => {
  test("preserves frontmatter and swaps the body", () => {
    const existing = "---\naliases: [Foo]\n---\nOld body.\n";
    expect(replacePageBody(existing, "New body, edited by the reviewer.")).toBe(
      "---\naliases: [Foo]\n---\nNew body, edited by the reviewer.\n",
    );
  });

  test("a page with no frontmatter just becomes the new body", () => {
    expect(replacePageBody("Old.\n", "New.\n\n")).toBe("New.\n");
  });

  test("normalizes trailing whitespace to a single newline", () => {
    expect(replacePageBody("---\nx: 1\n---\n", "Body  \n\n\n")).toBe(
      "---\nx: 1\n---\nBody\n",
    );
  });
});
