/**
 * Stream Deck API-key primitives (plan §8 / B26). Keys are minted in the web UI,
 * shown once, and stored only as a SHA-256 hash + a non-secret prefix. The raw
 * key is `lark_<base64url(32 random bytes)>`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface GeneratedKey {
  /** The raw secret — returned to the user exactly once, never stored. */
  readonly raw: string;
  /** SHA-256 hex of the raw key — what we persist + compare against. */
  readonly hash: string;
  /** Short non-secret leading slice, for display ("lark_AbC…"). */
  readonly prefix: string;
}

const PREFIX_LEN = 12;

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Generate a fresh API key (raw + its hash + display prefix). */
export function generateKey(): GeneratedKey {
  const raw = `lark_${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, PREFIX_LEN) };
}

/** Constant-time comparison of a presented key against a stored hash. */
export function verifyKey(rawPresented: string, storedHash: string): boolean {
  const a = Buffer.from(hashKey(rawPresented), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract a bearer/X-Lark-Key credential from request headers. */
export function extractApiKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim() || null;
  return headers.get("x-lark-key")?.trim() || null;
}
