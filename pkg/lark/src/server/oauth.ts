/**
 * Discord OAuth2 authorization-code flow (plan §8). Only the `identify` scope is
 * requested. URL building is pure; the token+user exchange takes an injectable
 * `fetch` so it is unit-testable without hitting Discord.
 */
export interface OAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface DiscordUser {
  readonly id: string;
  readonly username: string;
}

const AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";

/** Build the Discord authorize URL the browser is redirected to. */
export function buildAuthorizeUrl(cfg: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Exchange an authorization code for the Discord user identity. Throws on any
 * non-OK response so the caller can return a 502/401.
 */
export async function exchangeCodeForUser(
  cfg: OAuthConfig,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<DiscordUser> {
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Discord token exchange failed (${tokenRes.status})`);
  const token = (await tokenRes.json()) as { access_token?: string; token_type?: string };
  if (!token.access_token) throw new Error("Discord token response missing access_token");

  const userRes = await fetchImpl(USER_URL, {
    headers: { authorization: `${token.token_type ?? "Bearer"} ${token.access_token}` },
  });
  if (!userRes.ok) throw new Error(`Discord user fetch failed (${userRes.status})`);
  const user = (await userRes.json()) as { id?: string; username?: string };
  if (!user.id) throw new Error("Discord user response missing id");
  return { id: user.id, username: user.username ?? "unknown" };
}
