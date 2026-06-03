import { describe, it, expect } from "vitest";
import {
  defaultVisibleOverlays,
  parseOverlaysParam,
  serializeOverlaysParam,
} from "./overlays";

describe("parseOverlaysParam", () => {
  it("returns the default-visible set when the param is absent", () => {
    expect(parseOverlaysParam(undefined)).toEqual(defaultVisibleOverlays());
  });

  it("returns an empty set when the param is an empty string", () => {
    expect(parseOverlaysParam("")).toEqual(new Set());
  });

  it("parses a comma-separated list of known ids", () => {
    expect(parseOverlaysParam("regions")).toEqual(new Set(["regions"]));
  });

  it("drops unknown ids silently", () => {
    expect(parseOverlaysParam("regions,foo,bar")).toEqual(new Set(["regions"]));
  });

  it("ignores empty tokens and whitespace", () => {
    expect(parseOverlaysParam(", regions , ,")).toEqual(new Set(["regions"]));
  });
});

describe("serializeOverlaysParam", () => {
  it("returns undefined when the set matches the defaults", () => {
    expect(serializeOverlaysParam(defaultVisibleOverlays())).toBeUndefined();
  });

  it("returns an empty string when no overlays are visible", () => {
    expect(serializeOverlaysParam(new Set())).toBe("");
  });
});
