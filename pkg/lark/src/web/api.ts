/** Tiny same-origin fetch helper for the SPA. Cookies ride along automatically. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, await safeText(res));
  return (await res.json()) as T;
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeText(res));
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return res.statusText;
  }
}
