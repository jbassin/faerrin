import { test, expect, describe } from "bun:test"
import { isPlayer } from "./roster.ts"
import { username } from "./fileData.ts"

describe("isPlayer (shared-content roster SSOT)", () => {
  test("known player track stems resolve to players", () => {
    for (const stem of ["1-miked6187", "2-iiri___", "4-boiledpacakes", "5-tanner_kn", "6-nnaiman"]) {
      expect(isPlayer(username(stem))).toBe(true)
    }
  })

  test("non-players are excluded", () => {
    expect(isPlayer(username("0-craig"))).toBe(false) // recorder bot
    expect(isPlayer(username("weirdname"))).toBe(false) // no hyphen -> "" -> not a player
  })

  test("prototype keys are not players (Object.hasOwn guard)", () => {
    expect(isPlayer("constructor")).toBe(false)
    expect(isPlayer("toString")).toBe(false)
  })
})
