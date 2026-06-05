import { test, expect } from "bun:test"
import { resolveCampaign } from "./campaigns"
import type { Campaign } from "./types"

const campaigns: Campaign[] = [
  { name: "Through a Song, Darkly", isMain: true, roles: {} },
  { name: "Interred in Iomenei", isMain: false, roles: {} },
  { name: "Fae and Forest", isMain: false, roles: {} },
  { name: "Fey in the Mists", isMain: false, roles: {} },
]

test("resolves by 0-based index", () => {
  expect(resolveCampaign(campaigns, "0")?.name).toBe("Through a Song, Darkly")
  expect(resolveCampaign(campaigns, "1")?.name).toBe("Interred in Iomenei")
})

test("out-of-range index is null", () => {
  expect(resolveCampaign(campaigns, "9")).toBeNull()
})

test("resolves by case-insensitive name substring", () => {
  expect(resolveCampaign(campaigns, "song")?.name).toBe("Through a Song, Darkly")
  expect(resolveCampaign(campaigns, "IOMENEI")?.name).toBe("Interred in Iomenei")
})

test("no match is null", () => {
  expect(resolveCampaign(campaigns, "nonexistent")).toBeNull()
})

test("ambiguous substring throws", () => {
  // "f" appears in both "Fae and Forest" and "Fey in the Mists"
  expect(() => resolveCampaign(campaigns, "f")).toThrow(/ambiguous/)
})
