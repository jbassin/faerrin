import { test, expect, describe } from "bun:test";
import { DISTILL_TOOL_NAME, distillTool } from "./schema.ts";

describe("distillTool", () => {
  test("name matches the exported constant", () => {
    expect(distillTool.name).toBe(DISTILL_TOOL_NAME);
  });

  test("requires synopsis, beats, and discarded at the top level", () => {
    const schema = distillTool.input_schema as { required: string[] };
    expect(schema.required).toEqual(["synopsis", "beats", "discarded"]);
  });

  test("each beat requires the full set of Beat fields", () => {
    const schema = distillTool.input_schema as {
      properties: { beats: { items: { required: string[] } } };
    };
    expect(schema.properties.beats.items.required).toEqual([
      "order",
      "summary",
      "significance",
      "details",
      "tone",
      "tableAngle",
      "characters",
      "locations",
      "wikiRefs",
    ]);
  });
});
