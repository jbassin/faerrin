import { describe, it, expect } from "vitest";
import matter from "gray-matter";
import {
  slugify,
  layerFilename,
  serializeLayer,
  hexFactionMap,
  type EditableChange,
} from "./editorHelpers";

describe("slugify", () => {
  it("converts a plain name to lowercase kebab-case", () => {
    expect(slugify("Alkahest HQ")).toBe("alkahest-hq");
  });

  it("collapses runs of non-alphanumerics", () => {
    expect(slugify("Tinker's Row -- Expanded!")).toBe("tinker-s-row-expanded");
  });

  it("strips diacritics", () => {
    expect(slugify("Café Verdé")).toBe("cafe-verde");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --hello--  ")).toBe("hello");
  });
});

describe("layerFilename", () => {
  it("formats an ISO timestamp into a sortable filename", () => {
    expect(layerFilename("2026-05-22T14:30:00Z", "alkahest-hq")).toBe(
      "2026-05-22T143000-alkahest-hq.md",
    );
  });

  it("zero-pads short years to four digits so sort stays correct past year 999", () => {
    expect(layerFilename("863-07-13T14:21:00Z", "hildebrant-base")).toBe(
      "0863-07-13T142100-hildebrant-base.md",
    );
  });

  it("throws on an unparseable timestamp", () => {
    expect(() => layerFilename("not-a-date", "x")).toThrow(/ISO-8601/);
  });
});

describe("serializeLayer", () => {
  it("round-trips through gray-matter back to the same shape", () => {
    const changes: EditableChange[] = [
      {
        op: "add",
        slug: "alkahest-hq",
        name: "Alkahest HQ",
        faction: "alkahest-freight",
        hexes: [
          [16, -27],
          [17, -27],
        ],
      },
    ];
    const out = serializeLayer({
      timestamp: "2026-05-22T14:30:00Z",
      message: "A new HQ rises.",
      changes,
    });

    const parsed = matter(out);
    expect(parsed.data.timestamp).toBe("2026-05-22T14:30:00Z");
    expect(parsed.data.message).toBe("A new HQ rises.");
    expect(parsed.data.changes).toEqual([
      {
        op: "add",
        slug: "alkahest-hq",
        name: "Alkahest HQ",
        faction: "alkahest-freight",
        hexes: [
          [16, -27],
          [17, -27],
        ],
      },
    ]);
  });

  it("omits absent fields from an update change", () => {
    const out = serializeLayer({
      timestamp: "2026-05-22T14:30:00Z",
      message: "rename only",
      changes: [{ op: "update", slug: "hq", name: "New Name" }],
    });
    const parsed = matter(out);
    expect(parsed.data.changes[0]).toEqual({
      op: "update",
      slug: "hq",
      name: "New Name",
    });
  });

  it("preserves an optional body", () => {
    const out = serializeLayer({
      timestamp: "2026-05-22T14:30:00Z",
      message: "with body",
      changes: [{ op: "remove", slug: "gone" }],
      body: "Notes about this event.",
    });
    const parsed = matter(out);
    expect(parsed.content.trim()).toBe("Notes about this event.");
  });

  it("round-trips a skein-add", () => {
    const out = serializeLayer({
      timestamp: "2026-05-22T14:30:00Z",
      message: "Place a relay.",
      changes: [
        {
          op: "skein-add",
          slug: "signal-relay",
          name: "Signal Relay",
          faction: "alkahest-freight",
          hex: [16, -27],
          symbol: "symbols/skein-eye.svg",
        },
      ],
    });
    const parsed = matter(out);
    expect(parsed.data.changes[0]).toEqual({
      op: "skein-add",
      slug: "signal-relay",
      name: "Signal Relay",
      faction: "alkahest-freight",
      hex: [16, -27],
      symbol: "symbols/skein-eye.svg",
    });
  });

  it("round-trips a skein-connect (no slug field)", () => {
    const out = serializeLayer({
      timestamp: "2026-05-22T14:30:00Z",
      message: "Wire two nodes.",
      changes: [{ op: "skein-connect", from: "a-node", to: "b-node" }],
    });
    const parsed = matter(out);
    expect(parsed.data.changes[0]).toEqual({
      op: "skein-connect",
      from: "a-node",
      to: "b-node",
    });
  });

  it("round-trips a skein-remove", () => {
    const out = serializeLayer({
      timestamp: "2026-05-22T14:30:00Z",
      message: "Pull a relay.",
      changes: [{ op: "skein-remove", slug: "dead-drop" }],
    });
    const parsed = matter(out);
    expect(parsed.data.changes[0]).toEqual({
      op: "skein-remove",
      slug: "dead-drop",
    });
  });
});

describe("hexFactionMap", () => {
  it("assigns every existing faction hex to its faction index", () => {
    const m = hexFactionMap();
    // From session-1 example layer: (16,-27) is in Alkahest Freight (idx 1)
    expect(m.get("16,-27")).toBe(1);
    // (-27,13) is in Hildebrant Corp (idx 14)
    expect(m.get("-27,13")).toBe(14);
  });
});
