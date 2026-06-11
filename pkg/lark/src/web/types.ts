/** Shared shapes mirrored from the API (plan §5). */
export interface Tag {
  id: number;
  name: string;
  category: string | null;
  /** Optional #rrggbb. Colored tags tint + group rows; null = plain chip. */
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

export interface Playlist {
  id: number;
  name: string;
  loop_mode: "none" | "track" | "playlist";
  shuffle: number;
}
