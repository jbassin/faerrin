/**
 * Shapes mirrored from @faerrin/lark's HTTP API. lark does not publish an importable type
 * surface (no `exports`), so these are duplicated. Canonical sources:
 *   - NowPlaying:  pkg/lark/src/bot/playback.ts
 *   - Tag/Collection/Track: pkg/lark/src/web/types.ts
 * Keep in sync if lark's API changes.
 */

export interface Tag {
	id: number;
	name: string;
	category: string | null;
	/** Optional #rrggbb. Colored tags are the ones birdfeed shows as swatches; null = uncolored. */
	color: string | null;
	track_count?: number;
}

export interface Collection {
	id: number;
	name: string;
	slug: string;
	ip_or_game: string | null;
}

export interface Track {
	id: number;
	collection_id: number | null;
	title: string;
	original_title: string;
	status: "ready" | "downloading" | "error";
	duration_ms: number | null;
	loudness_lufs: number | null;
	tags: Tag[];
}

export type PlaybackStatus = "idle" | "playing" | "paused";
export type LoopMode = "none" | "track" | "playlist";

export interface NowPlaying {
	connected: boolean;
	channelId: string | null;
	status: PlaybackStatus;
	loopMode: LoopMode;
	current: {
		trackId: number;
		title: string;
		positionMs: number;
		durationMs: number | null;
	} | null;
	queueLength: number;
	queueIndex: number;
}

/** Query options for GET /api/v1/tracks. */
export interface TrackQuery {
	collection?: number;
	tag?: number;
	q?: string;
	page?: number;
	limit?: number;
}
