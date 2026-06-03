import { describe, it, expect } from "vitest";
import { getAllFactions, getFactionBySlug } from "./factions";

describe("getAllFactions", () => {
  it("returns exactly 20 factions", async () => {
    const factions = await getAllFactions();
    expect(factions).toHaveLength(20);
  });

  it("returns factions sorted by order ascending", async () => {
    const factions = await getAllFactions();
    const orders = factions.map((f) => f.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("has no duplicate slugs", async () => {
    const factions = await getAllFactions();
    const slugs = factions.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(20);
  });

  it("has no duplicate orders", async () => {
    const factions = await getAllFactions();
    const orders = factions.map((f) => f.order);
    expect(new Set(orders).size).toBe(20);
  });

  it("all factions have non-empty HTML descriptions", async () => {
    const factions = await getAllFactions();
    for (const faction of factions) {
      expect(
        faction.description.trim(),
        `${faction.slug} description is empty`,
      ).not.toBe("");
    }
  });
});

describe("getFactionBySlug", () => {
  it("returns the matching faction for a known slug", async () => {
    const faction = await getFactionBySlug("ternion-heavy-industries");
    expect(faction).not.toBeNull();
    expect(faction?.slug).toBe("ternion-heavy-industries");
    expect(faction?.name).toBe("Ternion Heavy Industries");
  });

  it("returns null for a non-existent slug", async () => {
    const result = await getFactionBySlug("does-not-exist");
    expect(result).toBeNull();
  });

  it("returns non-empty members array with non-empty HTML bios", async () => {
    const faction = await getFactionBySlug("ternion-heavy-industries");
    expect(faction?.members.length).toBeGreaterThan(0);
    for (const member of faction?.members ?? []) {
      expect(
        member.bio.trim(),
        `member "${member.name}" bio is empty`,
      ).not.toBe("");
    }
  });
});
