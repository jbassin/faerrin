import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Fragment } from "react";
import { parseMarkdown } from "./parse.ts";
import { renderNodes } from "./mdastToReact.tsx";

/** Render a markdown source to static HTML through the mdast→React layer. */
function html(source: string): string {
  const root = parseMarkdown(source);
  return renderToStaticMarkup(
    createElement(Fragment, null, renderNodes(root.children)),
  );
}

describe("mdastToReact", () => {
  test("renders top-level markdown: heading, list, link, emphasis", () => {
    const out = html("## Brief\n\n- one\n- two\n\n[t](https://x) and *em*");
    expect(out).toContain("<h2>Brief</h2>");
    expect(out).toContain("<ul>");
    expect(out).toContain("one"); // list item text (remark wraps it in <p>)
    expect(out).toContain('href="https://x"');
    expect(out).toContain("<em>em</em>");
  });

  test("never injects raw HTML (renders it escaped as code)", () => {
    const out = html("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  test("misplaced :::columns/:::column flags an ErrorChip but keeps content", () => {
    // A 3-colon `:::columns` leaks its body to the renderer (the column closes
    // it early). The escaped `column` directive must chip, not silently vanish.
    const out = html(":::column\norphan content\n:::");
    expect(out).toContain("only at top level");
    expect(out).toContain("orphan content");
  });
});
