// Add `id` slugs to headings, matching Astro's default `rehypeHeadingIds`
// (heart.iridi.cc emits `<h3 id="enlightenment">`). Astro uses a per-document
// github-slugger instance — same library, same dedup (`-1`, `-2`) — so this is
// byte-faithful. rehype-slug isn't available offline; this is a 20-line stand-in.
import GithubSlugger from "github-slugger";
import { visit } from "unist-util-visit";
import type { Root, Element, Text } from "hast";

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function textOf(node: Element): string {
  let out = "";
  visit(node, "text", (t: Text) => {
    out += t.value;
  });
  return out;
}

export function rehypeHeadingIds() {
  return (tree: Root) => {
    const slugger = new GithubSlugger();
    visit(tree, "element", (node: Element) => {
      if (!HEADINGS.has(node.tagName)) return;
      node.properties = node.properties ?? {};
      if (node.properties.id) return; // respect an explicit id
      node.properties.id = slugger.slug(textOf(node));
    });
  };
}
