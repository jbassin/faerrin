import type { Collection, NowPlaying, Tag, Track, TrackQuery } from "./types";

export interface LarkConfig {
	/** e.g. "https://lark.iridi.cc" or "http://localhost:8788". Trailing slash tolerated. */
	origin: string;
	/** A `lark_…` API key minted in lark's web UI. Sent as `Authorization: Bearer …`. */
	key: string;
}

/** Thrown for any non-2xx lark response. `status` carries the HTTP code (401/409/503/…). */
export class LarkError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "LarkError";
	}
}

/**
 * Build the relative path + query string for GET /api/v1/tracks. Pure so it can be unit-tested.
 * Only defined filters are emitted, so the lark default (limit 200) applies when omitted.
 */
export function tracksPath(q: TrackQuery = {}): string {
	const params = new URLSearchParams();
	if (q.collection !== undefined) params.set("collection", String(q.collection));
	if (q.tag !== undefined) params.set("tag", String(q.tag));
	if (q.q !== undefined && q.q !== "") params.set("q", q.q);
	if (q.page !== undefined) params.set("page", String(q.page));
	if (q.limit !== undefined) params.set("limit", String(q.limit));
	const qs = params.toString();
	return qs ? `/api/v1/tracks?${qs}` : "/api/v1/tracks";
}

/** Strip a single trailing slash so `${origin}${path}` never doubles up. Pure. */
export function normalizeOrigin(origin: string): string {
	return origin.replace(/\/+$/, "");
}

/** Thin REST client for lark's Stream Deck API. Uses Node 20's global `fetch`. */
export class LarkClient {
	private readonly origin: string;
	private readonly key: string;

	constructor(config: LarkConfig) {
		this.origin = normalizeOrigin(config.origin);
		this.key = config.key;
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		let res: Response;
		try {
			res = await fetch(`${this.origin}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${this.key}`,
					...(body !== undefined ? { "Content-Type": "application/json" } : {}),
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
		} catch (cause) {
			throw new LarkError(0, `network error contacting lark: ${(cause as Error).message}`);
		}
		if (!res.ok) {
			throw new LarkError(res.status, `lark ${method} ${path} → ${res.status}`);
		}
		// Some endpoints (204) have no body; callers that expect T won't use those.
		if (res.status === 204) return undefined as T;
		return (await res.json()) as T;
	}

	// ---- library ----
	collections(): Promise<Collection[]> {
		return this.request<Collection[]>("GET", "/api/v1/collections");
	}
	tags(): Promise<(Tag & { track_count: number })[]> {
		return this.request<(Tag & { track_count: number })[]>("GET", "/api/v1/tags");
	}
	tracks(query?: TrackQuery): Promise<Track[]> {
		return this.request<Track[]>("GET", tracksPath(query));
	}

	// ---- playback ----
	now(): Promise<NowPlaying> {
		return this.request<NowPlaying>("GET", "/api/v1/playback/now");
	}
	play(body: { trackId?: number; trackIds?: number[]; collectionId?: number; playlistId?: number; channelId?: string }): Promise<NowPlaying> {
		return this.request<NowPlaying>("POST", "/api/v1/playback/play", body);
	}
	pause(): Promise<NowPlaying> {
		return this.request<NowPlaying>("POST", "/api/v1/playback/pause");
	}
	resume(): Promise<NowPlaying> {
		return this.request<NowPlaying>("POST", "/api/v1/playback/resume");
	}
	stop(): Promise<NowPlaying> {
		return this.request<NowPlaying>("POST", "/api/v1/playback/stop");
	}
	next(): Promise<NowPlaying> {
		return this.request<NowPlaying>("POST", "/api/v1/playback/next");
	}
	prev(): Promise<NowPlaying> {
		return this.request<NowPlaying>("POST", "/api/v1/playback/prev");
	}
}
