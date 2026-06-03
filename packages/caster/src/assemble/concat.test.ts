import { test, expect, describe } from "bun:test";
import { buildConcatList } from "./concat.ts";

describe("buildConcatList", () => {
  test("interleaves clips with silence and ends on a clip", () => {
    const list = buildConcatList(
      ["/a/001.mp3", "/a/002.mp3", "/a/003.mp3"],
      [250, 500],
      (ms) => `/a/gap-${ms}.mp3`,
    );
    expect(list).toBe(
      [
        "file '/a/001.mp3'",
        "file '/a/gap-250.mp3'",
        "file '/a/002.mp3'",
        "file '/a/gap-500.mp3'",
        "file '/a/003.mp3'",
        "",
      ].join("\n"),
    );
  });

  test("single clip has no gap lines", () => {
    expect(buildConcatList(["/a/001.mp3"], [], () => "x")).toBe("file '/a/001.mp3'\n");
  });

  test("escapes single quotes in paths", () => {
    expect(buildConcatList(["/a/it's.mp3"], [], () => "x")).toBe("file '/a/it'\\''s.mp3'\n");
  });
});
