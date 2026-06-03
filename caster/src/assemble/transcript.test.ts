import { test, expect, describe } from "bun:test";
import type { Script } from "../types.ts";
import { renderTranscript } from "./transcript.ts";

function script(): Script {
  return {
    sessionId: "x",
    title: "The Departure Gala",
    hosts: {
      A: { name: "Reed", persona: "" },
      B: { name: "Quill", persona: "" },
      C: { name: "Charlotte", persona: "" },
    },
    turns: [
      { speaker: "A", text: "Welcome back!", emotion: "warm" },
      { speaker: "B", text: "Strap in." },
    ],
  };
}

describe("renderTranscript", () => {
  const md = renderTranscript(script());

  test("includes the title and a host legend", () => {
    expect(md).toContain("# The Departure Gala");
    expect(md).toContain("Reed (the Recapper)");
    expect(md).toContain("Quill (the Lorekeeper)");
  });

  test("labels each turn by host name and shows a legacy emotion as a v3 tag", () => {
    expect(md).toContain("**Reed:** [warm] Welcome back!");
    expect(md).toContain("**Quill:** Strap in.");
  });

  test("keeps inline v3 audio tags verbatim", () => {
    const tagged = renderTranscript({
      sessionId: "x",
      title: "T",
      hosts: {
      A: { name: "Reed", persona: "" },
      B: { name: "Quill", persona: "" },
      C: { name: "Charlotte", persona: "" },
    },
      turns: [{ speaker: "A", text: "[whispers] Did you hear that? [pause] No?" }],
    });
    expect(tagged).toContain("**Reed:** [whispers] Did you hear that? [pause] No?");
  });
});
