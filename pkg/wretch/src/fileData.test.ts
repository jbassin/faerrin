import { test, expect, describe } from "bun:test"
import { username, index, date } from "./fileData.ts"

describe("username/index", () => {
  test("plain id, no underscore -> id and index 0", () => {
    expect(username("1-miked6187")).toBe("miked6187")
    expect(index("1-miked6187")).toBe("0")
  })

  test("underscore id -> last segment is the index", () => {
    expect(username("5-tanner_kn")).toBe("tanner")
    expect(index("5-tanner_kn")).toBe("kn")
  })

  test("trailing underscores -> empty index, joined user (iiri___ case)", () => {
    // "iiri___".split("_") === ["iiri","","",""]
    expect(username("2-iiri___")).toBe("iiri__")
    expect(index("2-iiri___")).toBe("")
  })

  test("not exactly one hyphen -> empty", () => {
    expect(username("noindexhere")).toBe("")
    expect(index("a-b-c")).toBe("")
  })
})

describe("date", () => {
  test("4-field underscore name -> 3rd field", () => {
    expect(date("craig_recording_2026-5-21_final")).toBe("2026-5-21")
  })

  test("wrong field count -> empty", () => {
    expect(date("1-miked6187")).toBe("")
    expect(date("a_b_c")).toBe("")
  })
})
