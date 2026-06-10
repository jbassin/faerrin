import { expect, test } from "bun:test";

// Phase A smoke test — proves the package is wired into the workspace test fan-out.
// Real coverage (payload schema, SSE hub fan-out) arrives with Phase B.
test("eerie scaffold is wired into the test runner", () => {
  expect(1 + 1).toBe(2);
});
