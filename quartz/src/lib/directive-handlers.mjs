// remark-rehype handlers for directive nodes.
//
// Our transcript remark plugin sets `data.hName`/`data.hProperties` on the
// directive nodes (the standard remark-directive pattern). A vanilla
// remark-rehype honors that via its default unknown-node handler, but Astro's
// markdown pipeline drops `containerDirective` nodes specifically (leaf/text
// survive). Registering these explicit handlers forces correct, deterministic
// output regardless of Astro's internals: build an element from hName +
// hProperties and recurse into children.
function directiveToHast(state, node) {
  const data = node.data || {}
  return {
    type: "element",
    tagName: data.hName || "div",
    properties: data.hProperties || {},
    children: state.all(node),
  }
}

export const directiveHandlers = {
  containerDirective: directiveToHast,
  leafDirective: directiveToHast,
  textDirective: directiveToHast,
}
