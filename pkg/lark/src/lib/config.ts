/**
 * Environment/config helpers shared across the bot, server, and spike.
 *
 * Kept dependency-free and pure (no Discord, no ffmpeg, no DB) so it is
 * unit-testable in the CI bun lane without any native modules or binaries.
 */

/** Read a required env var or throw a clear, actionable error. */
export function requireEnv(name: string, env: Record<string, string | undefined> = process.env): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required env var ${name} — copy .env.example to .env and fill it in.`);
  }
  return value.trim();
}

/** Read an optional env var, falling back to `fallback`. */
export function optionalEnv(
  name: string,
  fallback: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

/**
 * Parse the `LARK_ALLOWED_USER_IDS` allowlist: comma/whitespace-separated
 * Discord user IDs. Empty/blank entries are dropped; order is irrelevant since
 * callers use membership checks.
 */
export function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

/** Whether a given Discord user ID is permitted (allowlist membership). */
export function isAllowed(userId: string, allowlist: Set<string>): boolean {
  return allowlist.has(userId);
}
