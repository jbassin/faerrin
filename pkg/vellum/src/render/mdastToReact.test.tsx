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

  describe("GFM", () => {
    test("renders a table with header and per-column alignment", () => {
      const out = html("| A | B |\n|:--|--:|\n| 1 | 2 |");
      expect(out).toContain("<table>");
      expect(out).toContain("<thead>");
      expect(out).toContain("<th"); // header cells
      expect(out).toMatch(/<th style="text-align:left">A/);
      expect(out).toMatch(/<th style="text-align:right">B/);
      expect(out).toContain("<tbody>");
      expect(out).toContain("<td"); // body cells
    });

    test("strikethrough renders <del>", () => {
      expect(html("~~gone~~")).toContain("<del>gone</del>");
    });

    test("task list items render read-only checkboxes", () => {
      const out = html("- [x] done\n- [ ] todo");
      expect((out.match(/type="checkbox"/g) ?? []).length).toBe(2);
      expect(out).toContain("checked=");
      expect(out).toContain("disabled");
    });

    test("bare URLs become autolinks", () => {
      expect(html("see https://example.com now")).toContain(
        'href="https://example.com"',
      );
    });

    test("footnotes render a superscript reference and a definition block", () => {
      const out = html("Claim.[^a]\n\n[^a]: because.");
      expect(out).toContain("data-footnote-ref");
      expect(out).toContain("data-footnote=");
      expect(out).toContain("because");
    });
  });
});
