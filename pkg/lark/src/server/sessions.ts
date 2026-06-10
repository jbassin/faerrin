/**
 * Stateless signed session cookies (plan §8). A session is `uid.exp.sig` where
 * sig = HMAC-SHA256(`uid.exp`, SESSION_SECRET), base64url. No DB row needed —
 * the cookie itself is the credential, tamper-evident and self-expiring.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface Session {
  /** Discord user ID of the logged-in operator. */
  readonly uid: string;
  /** Expiry, epoch seconds. */
  readonly exp: number;
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(data: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(data).digest());
}

/** Mint a signed session token for `uid`, valid for `ttlSeconds`. */
export function signSession(uid: string, secret: string, ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const data = `${uid}.${exp}`;
  return `${data}.${sign(data, secret)}`;
}

/** Verify + parse a session token. Returns null on any tamper/format/expiry failure. */
export function verifySession(token: string | undefined, secret: string, now = Date.now()): Session | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [uid, expStr, sig] = parts as [string, string, string];
  const expected = sign(`${uid}.${expStr}`, secret);
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws then).
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  if (Math.floor(now / 1000) >= exp) return null;
  if (!uid) return null;
  return { uid, exp };
}

/** Serialize a `Set-Cookie` header value for the session cookie. */
export function sessionCookie(name: string, value: string, opts: { maxAge?: number; secure?: boolean } = {}): string {
  const attrs = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    opts.secure === false ? "" : "Secure",
    `Max-Age=${opts.maxAge ?? DEFAULT_TTL_SECONDS}`,
  ].filter(Boolean);
  return attrs.join("; ");
}

/** Serialize a cookie that clears the session. */
export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Parse a `Cookie` request header into a name→value map. */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
