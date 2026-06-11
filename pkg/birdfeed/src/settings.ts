/** Plugin-wide settings, set via the Property Inspector and stored in Stream Deck global settings. */
export interface BirdfeedGlobalSettings {
	/** A `lark_…` API key minted in lark's web UI. The lark origin is fixed (see controller). */
	larkKey?: string;
}

/** Per-key settings. birdfeed derives a key's role from coordinates + nav state, so none are needed. */
export type SlotSettings = Record<string, never>;

export function isConfigured(s: BirdfeedGlobalSettings): s is Required<BirdfeedGlobalSettings> {
	return !!s.larkKey;
}
