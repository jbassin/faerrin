/**
 * Typed application config assembled from env (plan §8). Kept separate from the
 * server so tests can build a config literal without touching `process.env`.
 */
import { resolve } from "node:path";
import type { OAuthConfig } from "../server/oauth";
import { optionalEnv, parseAllowlist, requireEnv } from "./config";

export interface AppConfig {
  readonly port: number;
  readonly sessionSecret: string;
  readonly allowlist: Set<string>;
  readonly oauth: OAuthConfig;
  readonly publicOrigin: string;
  /** `Secure` cookies whenever the public origin is https (i.e. in prod). */
  readonly secureCookies: boolean;
  readonly distDir: string;
  readonly dataDir: string;
  readonly dbPath: string;
  readonly guildId: string;
  readonly targetLufs: number;
}

/** Build config from an env map (defaults to `process.env`). */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const publicOrigin = optionalEnv("LARK_PUBLIC_ORIGIN", "http://localhost:8788", env);
  const dataDir = resolve(optionalEnv("LARK_DATA_DIR", resolve(import.meta.dir, "../../data"), env));
  return {
    port: Number(optionalEnv("PORT", "8788", env)),
    sessionSecret: requireEnv("SESSION_SECRET", env),
    allowlist: parseAllowlist(env.LARK_ALLOWED_USER_IDS),
    oauth: {
      clientId: requireEnv("DISCORD_CLIENT_ID", env),
      clientSecret: requireEnv("DISCORD_CLIENT_SECRET", env),
      redirectUri: `${publicOrigin}/auth/callback`,
    },
    publicOrigin,
    secureCookies: publicOrigin.startsWith("https://"),
    distDir: resolve(optionalEnv("LARK_DIST_DIR", resolve(import.meta.dir, "../../dist"), env)),
    dataDir,
    dbPath: resolve(dataDir, "lark.sqlite"),
    guildId: optionalEnv("LARK_GUILD_ID", "", env),
    targetLufs: Number(optionalEnv("LARK_TARGET_LUFS", "-16", env)),
  };
}
