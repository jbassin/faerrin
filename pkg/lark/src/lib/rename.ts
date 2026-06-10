/**
 * Bulk-rename engine (plan B13). Pure + dependency-free so it is fully
 * unit-tested and can also run client-side for live preview. YouTube titles are
 * long and noisy; these ops let the operator clean many at once with a preview
 * before committing.
 */
export type RenameOp =
  | { kind: "replace"; find: string; replaceWith: string; regex?: boolean; caseInsensitive?: boolean }
  | { kind: "stripPrefix"; value: string }
  | { kind: "stripSuffix"; value: string }
  | { kind: "collapseWhitespace" }
  | { kind: "set"; value: string };

export interface RenamePreviewRow {
  readonly id: number;
  readonly from: string;
  readonly to: string;
  readonly changed: boolean;
}

/** Apply a single op to a title. Throws on an invalid user-supplied regex. */
function applyOp(title: string, op: RenameOp): string {
  switch (op.kind) {
    case "set":
      return op.value;
    case "collapseWhitespace":
      return title.replace(/\s+/g, " ").trim();
    case "stripPrefix":
      return title.startsWith(op.value) ? title.slice(op.value.length) : title;
    case "stripSuffix":
      return title.endsWith(op.value) ? title.slice(0, title.length - op.value.length) : title;
    case "replace": {
      if (op.regex) {
        let re: RegExp;
        try {
          re = new RegExp(op.find, `g${op.caseInsensitive ? "i" : ""}`);
        } catch (err) {
          throw new RenameError(`invalid regex: ${(err as Error).message}`);
        }
        return title.replace(re, op.replaceWith);
      }
      // Literal replace-all without regex semantics.
      if (op.find === "") return title;
      const needle = op.caseInsensitive ? op.find.toLowerCase() : op.find;
      let out = "";
      let i = 0;
      while (i < title.length) {
        const hay = op.caseInsensitive ? title.slice(i, i + op.find.length).toLowerCase() : title.slice(i, i + op.find.length);
        if (hay === needle) {
          out += op.replaceWith;
          i += op.find.length;
        } else {
          out += title[i];
          i++;
        }
      }
      return out;
    }
  }
}

export class RenameError extends Error {}

/** Apply an ordered list of ops to one title. */
export function applyRename(title: string, ops: readonly RenameOp[]): string {
  return ops.reduce<string>((acc, op) => applyOp(acc, op), title);
}

/** Compute a preview for a batch — `from`/`to`/`changed` per item, never mutating. */
export function previewBulkRename(
  items: readonly { id: number; title: string }[],
  ops: readonly RenameOp[],
): RenamePreviewRow[] {
  return items.map((item) => {
    const to = applyRename(item.title, ops);
    return { id: item.id, from: item.title, to, changed: to !== item.title };
  });
}
