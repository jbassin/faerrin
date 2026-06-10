import { describe, expect, test } from "bun:test";
import { RenameError, applyRename, previewBulkRename } from "../src/lib/rename";

describe("applyRename", () => {
  test("literal replace-all", () => {
    expect(applyRename("OST - Track (Official)", [{ kind: "replace", find: " (Official)", replaceWith: "" }])).toBe(
      "OST - Track",
    );
  });
  test("case-insensitive literal replace", () => {
    expect(applyRename("HELLO hello", [{ kind: "replace", find: "hello", replaceWith: "x", caseInsensitive: true }])).toBe(
      "x x",
    );
  });
  test("regex replace with capture", () => {
    expect(
      applyRename("12 - Boss Theme", [{ kind: "replace", find: "^\\d+ - ", replaceWith: "", regex: true }]),
    ).toBe("Boss Theme");
  });
  test("strip prefix/suffix", () => {
    expect(applyRename("[FF7] Theme", [{ kind: "stripPrefix", value: "[FF7] " }])).toBe("Theme");
    expect(applyRename("Theme.mp3", [{ kind: "stripSuffix", value: ".mp3" }])).toBe("Theme");
  });
  test("collapse whitespace", () => {
    expect(applyRename("  a   b  ", [{ kind: "collapseWhitespace" }])).toBe("a b");
  });
  test("set overrides", () => {
    expect(applyRename("whatever", [{ kind: "set", value: "Fixed" }])).toBe("Fixed");
  });
  test("ops chain in order", () => {
    expect(
      applyRename("01 - Town Theme (Official Video)", [
        { kind: "replace", find: "^\\d+ - ", replaceWith: "", regex: true },
        { kind: "replace", find: " (Official Video)", replaceWith: "" },
      ]),
    ).toBe("Town Theme");
  });
  test("invalid regex throws RenameError", () => {
    expect(() => applyRename("x", [{ kind: "replace", find: "(", replaceWith: "", regex: true }])).toThrow(RenameError);
  });
});

describe("previewBulkRename", () => {
  test("marks changed rows and never mutates input", () => {
    const items = [
      { id: 1, title: "01 - A" },
      { id: 2, title: "B" },
    ];
    const rows = previewBulkRename(items, [{ kind: "replace", find: "^\\d+ - ", replaceWith: "", regex: true }]);
    expect(rows).toEqual([
      { id: 1, from: "01 - A", to: "A", changed: true },
      { id: 2, from: "B", to: "B", changed: false },
    ]);
    expect(items[0]!.title).toBe("01 - A");
  });
});
