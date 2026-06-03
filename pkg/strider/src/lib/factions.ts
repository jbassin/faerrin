import { FACTIONS, factionBySlug } from "@/generated/factions";

export interface Member {
  name: string;
  bio: string;
}

export interface Faction {
  name: string;
  slug: string;
  color: string;
  order: number;
  symbol: string | null;
  description: string;
  members: Member[];
}

export async function getAllFactions(): Promise<Faction[]> {
  return FACTIONS as Faction[];
}

export async function getFactionBySlug(slug: string): Promise<Faction | null> {
  return factionBySlug(slug) ?? null;
}
