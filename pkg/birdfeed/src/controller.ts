/**
 * Central controller: owns per-device navigation state, the visible-slot registry, the lark client,
 * the now-playing poller, and all rendering. The Slot action is a thin shim that forwards events
 * here. SDK-coupled concerns live here; the pure logic lives in grid/nav/render/tags.
 */

import streamDeck, { type KeyAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { type DeviceShape, type GridData, type Role, layout, roleAt, trackCapacity, totalPages, tracksForSelector } from "./grid";
import { LarkClient, LarkError } from "./lark/client";
import type { Collection, NowPlaying, Tag, Track } from "./lark/types";
import { back, openCollection, rootNav, selectTag, withPage, type NavState } from "./nav";
import { normalizeHex } from "./render/color";
import { messageSvg, renderRole, type RenderOpts } from "./render/svg";
import { isConfigured, type BirdfeedGlobalSettings } from "./settings";
import { NAMED_TAG_KEYS, type TagKey } from "./tags";

const POLL_MS = 2500;
const TRANSIENT_MS = 1800;
const DEFAULT_SHAPE: DeviceShape = { columns: 8, rows: 4 }; // XL fallback
const LARK_ORIGIN = "https://lark.iridi.cc"; // fixed; only the API key is configurable

interface SlotRef {
	action: KeyAction;
	deviceId: string;
	column: number;
	row: number;
}

interface DeviceState {
	shape: DeviceShape;
	nav: NavState;
	/** All tracks in the current collection (the tag page filters these per selector). */
	tracks: Track[];
}

function playbackErrorMessage(err: unknown): string {
	if (err instanceof LarkError && err.status === 409) return "Join a voice channel first";
	if (err instanceof LarkError && err.status === 503) return "lark bot offline";
	return "Playback failed";
}

export class BirdfeedController {
	private client: LarkClient | null = null;
	private collections: Collection[] = [];
	private collectionsLoaded = false;
	private tagsLoaded = false;
	private now: NowPlaying | null = null;

	// Resolved fixed-tag taxonomy (rebuilt from lark's /tags).
	private readonly namedTagIds = new Map<TagKey, number>();
	private readonly tagColors = new Map<TagKey, string | null>();
	private readonly tagResolved = new Set<TagKey>();

	private readonly slots = new Map<string, SlotRef>(); // by action context id
	private readonly devices = new Map<string, DeviceState>();
	private readonly lastImage = new Map<string, string>(); // context → last setImage value
	private readonly transient = new Set<string>(); // contexts showing a transient message
	private readonly transientTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private poller: ReturnType<typeof setInterval> | null = null;
	/** Bumped whenever the lark config changes, so stale in-flight loads don't write old data. */
	private generation = 0;

	// ---- configuration ----

	async init(): Promise<void> {
		const settings = (await streamDeck.settings.getGlobalSettings()) as BirdfeedGlobalSettings;
		this.applySettings(settings);
		streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
			this.applySettings(ev.settings as BirdfeedGlobalSettings);
			void this.reloadAndRenderAll();
		});
	}

	private applySettings(settings: BirdfeedGlobalSettings): void {
		this.generation++;
		this.client = isConfigured(settings) ? new LarkClient({ origin: LARK_ORIGIN, key: settings.larkKey }) : null;
		this.collectionsLoaded = false;
		this.collections = [];
		this.tagsLoaded = false;
		this.resolveTags([]);
	}

	private async reloadAndRenderAll(): Promise<void> {
		for (const ds of this.devices.values()) {
			ds.nav = rootNav();
			ds.tracks = [];
		}
		await this.ensureLibrary();
		for (const deviceId of this.devices.keys()) await this.renderDevice(deviceId);
		this.syncPoller();
	}

	// ---- slot lifecycle (called by the Slot action) ----

	async onWillAppear(ev: WillAppearEvent): Promise<void> {
		const action = ev.action;
		if (!action.isKey()) return; // birdfeed is keypad-only
		const coord = action.coordinates ?? { column: 0, row: 0 };
		const deviceId = action.device.id;
		this.slots.set(action.id, { action, deviceId, column: coord.column, row: coord.row });

		const shape = this.deviceShape(action);
		const existing = this.devices.get(deviceId);
		if (existing) existing.shape = shape;
		else this.devices.set(deviceId, { shape, nav: rootNav(), tracks: [] });

		await this.ensureLibrary();
		await this.renderSlot(action.id);
		this.syncPoller();
	}

	onWillDisappear(ev: WillDisappearEvent): void {
		this.slots.delete(ev.action.id);
		this.lastImage.delete(ev.action.id);
		this.transient.delete(ev.action.id);
		const timer = this.transientTimers.get(ev.action.id);
		if (timer) {
			clearTimeout(timer);
			this.transientTimers.delete(ev.action.id);
		}
		const deviceId = ev.action.device.id;
		if (![...this.slots.values()].some((s) => s.deviceId === deviceId)) {
			this.devices.delete(deviceId);
		}
		this.syncPoller();
	}

	async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const ref = this.slots.get(ev.action.id);
		const ds = ref && this.devices.get(ref.deviceId);
		if (!ref || !ds || !this.client) return;
		const role = roleAt(layout(ds.nav, ds.shape, this.gridData(ds)), { column: ref.column, row: ref.row }, ds.shape);
		await this.dispatch(role, ds, ref);
	}

	// ---- dispatch ----

	private async dispatch(role: Role, ds: DeviceState, ref: SlotRef): Promise<void> {
		switch (role.kind) {
			case "back":
				ds.nav = back(ds.nav);
				return this.renderDevice(ref.deviceId);
			case "pagePrev":
				ds.nav = withPage(ds.nav, ds.nav.page - 1);
				return this.renderDevice(ref.deviceId);
			case "pageNext":
				ds.nav = withPage(ds.nav, Math.min(ds.nav.page + 1, this.tagPageCount(ds) - 1));
				return this.renderDevice(ref.deviceId);
			case "collection":
				ds.nav = openCollection(role.id, role.name);
				await this.loadCollection(ds, role.id);
				return this.renderDevice(ref.deviceId);
			case "navTag":
				if (!role.resolved) return; // unresolved tag → no-op
				ds.nav = selectTag(ds.nav, role.key);
				return this.renderDevice(ref.deviceId);
			case "playPause":
				return this.togglePlayPause(ref);
			case "stop":
				return this.stopPlayback(ref);
			case "track":
				return this.toggleTrack(ref, role.id);
			case "pageInfo":
			case "empty":
				return;
		}
	}

	private async togglePlayPause(ref: SlotRef): Promise<void> {
		if (!this.client) return;
		try {
			if (this.now?.status === "playing") this.now = await this.client.pause();
			else if (this.now?.status === "paused") this.now = await this.client.resume();
			else return; // idle: nothing to toggle
			await this.renderDevice(ref.deviceId);
		} catch (err) {
			await this.showTransient(ref.action.id, messageSvg(playbackErrorMessage(err), "error"));
		}
	}

	private async stopPlayback(ref: SlotRef): Promise<void> {
		if (!this.client) return;
		try {
			this.now = await this.client.stop();
			await this.renderDevice(ref.deviceId);
		} catch (err) {
			await this.showTransient(ref.action.id, messageSvg(playbackErrorMessage(err), "error"));
		}
	}

	/** Press a track: toggle if it's the current track, otherwise play it. */
	private async toggleTrack(ref: SlotRef, trackId: number): Promise<void> {
		if (!this.client) return;
		try {
			const current = this.now?.current?.trackId;
			if (current === trackId && this.now?.status === "playing") this.now = await this.client.pause();
			else if (current === trackId && this.now?.status === "paused") this.now = await this.client.resume();
			else this.now = await this.client.play({ trackId });
			await this.renderDevice(ref.deviceId);
		} catch (err) {
			await this.showTransient(ref.action.id, messageSvg(playbackErrorMessage(err), "error"));
		}
	}

	// ---- data loading ----

	/** Load collections + the fixed-tag taxonomy (both global), once per config. */
	private async ensureLibrary(): Promise<void> {
		if (!this.client) return;
		const client = this.client;
		const gen = this.generation;
		if (!this.collectionsLoaded) {
			try {
				const collections = await client.collections();
				if (this.generation === gen && this.client === client) {
					this.collections = collections;
					this.collectionsLoaded = true;
				}
			} catch {
				if (this.generation === gen) this.collections = [];
			}
		}
		if (!this.tagsLoaded) {
			try {
				const tags = await client.tags();
				if (this.generation === gen && this.client === client) {
					this.resolveTags(tags);
					this.tagsLoaded = true;
				}
			} catch {
				if (this.generation === gen) this.resolveTags([]);
			}
		}
	}

	/** Resolve the five named tag keys against lark tags (by lowercase name); "other" is the catch-all. */
	private resolveTags(tags: Tag[]): void {
		const byName = new Map<string, Tag>();
		for (const t of tags) byName.set(t.name.toLowerCase(), t);
		this.namedTagIds.clear();
		this.tagColors.clear();
		this.tagResolved.clear();
		for (const key of NAMED_TAG_KEYS) {
			const t = byName.get(key);
			if (t) {
				this.namedTagIds.set(key, t.id);
				this.tagColors.set(key, normalizeHex(t.color));
				this.tagResolved.add(key);
			} else {
				this.tagColors.set(key, null);
			}
		}
		// "other" is always selectable (catch-all), rendered neutral.
		this.tagResolved.add("other");
		this.tagColors.set("other", null);
	}

	private async loadCollection(ds: DeviceState, collectionId: number): Promise<void> {
		if (!this.client) return;
		const client = this.client;
		const gen = this.generation;
		try {
			const tracks = await client.tracks({ collection: collectionId, limit: 500 });
			if (this.generation === gen && this.client === client) ds.tracks = tracks;
		} catch {
			if (this.generation === gen) ds.tracks = [];
		}
	}

	private gridData(ds: DeviceState): GridData {
		let tracks: Track[] = [];
		let activeColor: string | null = null;
		if (ds.nav.level === "tag") {
			tracks = tracksForSelector(ds.tracks, ds.nav.tagKey, this.namedTagIds);
			activeColor = this.tagColors.get(ds.nav.tagKey) ?? null;
		}
		return {
			collections: this.collections,
			tagColors: this.tagColors,
			tagResolved: this.tagResolved,
			tracks,
			activeColor,
		};
	}

	private tagPageCount(ds: DeviceState): number {
		if (ds.nav.level !== "tag") return 1;
		const n = tracksForSelector(ds.tracks, ds.nav.tagKey, this.namedTagIds).length;
		return totalPages(n, trackCapacity(ds.shape));
	}

	// ---- rendering ----

	private deviceShape(action: KeyAction): DeviceShape {
		const size = action.device.size;
		if (size && size.columns && size.rows) return { columns: size.columns, rows: size.rows };
		return DEFAULT_SHAPE;
	}

	/** Now-playing context for the roles that depend on it (track tiles + the play/pause key). */
	private renderOptsFor(role: Role): RenderOpts {
		if (role.kind === "playPause") {
			return { playing: this.now?.status === "playing", paused: this.now?.status === "paused" };
		}
		if (role.kind === "track" && this.now?.current && this.now.current.trackId === role.id) {
			return {
				playing: this.now.status === "playing",
				paused: this.now.status === "paused",
				positionMs: this.now.current.positionMs,
				durationMs: this.now.current.durationMs,
			};
		}
		return {};
	}

	private async renderSlot(context: string): Promise<void> {
		const ref = this.slots.get(context);
		const ds = ref && this.devices.get(ref.deviceId);
		if (!ref || !ds || this.transient.has(context)) return;

		let image: string;
		if (!this.client) {
			image = messageSvg("Set lark API key in settings");
		} else {
			const role = roleAt(layout(ds.nav, ds.shape, this.gridData(ds)), { column: ref.column, row: ref.row }, ds.shape);
			image = renderRole(role, this.renderOptsFor(role));
		}
		if (this.lastImage.get(context) === image) return; // diff: skip redundant setImage
		this.lastImage.set(context, image);
		await ref.action.setImage(image);
	}

	private async renderDevice(deviceId: string): Promise<void> {
		const contexts = [...this.slots.entries()].filter(([, s]) => s.deviceId === deviceId).map(([c]) => c);
		await Promise.all(contexts.map((c) => this.renderSlot(c)));
	}

	/** Repaint only the now-playing-dependent keys (track tiles + play/pause) — used by the poller. */
	private async renderNowDependent(): Promise<void> {
		const jobs: Promise<void>[] = [];
		for (const [context, ref] of this.slots) {
			const ds = this.devices.get(ref.deviceId);
			if (!ds || ds.nav.level !== "tag") continue;
			const role = roleAt(layout(ds.nav, ds.shape, this.gridData(ds)), { column: ref.column, row: ref.row }, ds.shape);
			if (role.kind === "track" || role.kind === "playPause") jobs.push(this.renderSlot(context));
		}
		await Promise.all(jobs);
	}

	private async showTransient(context: string, image: string): Promise<void> {
		const ref = this.slots.get(context);
		if (!ref) return;
		this.transient.add(context);
		this.lastImage.delete(context);
		const existing = this.transientTimers.get(context);
		if (existing) clearTimeout(existing);
		await ref.action.setImage(image);
		const timer = setTimeout(() => {
			this.transientTimers.delete(context);
			this.transient.delete(context);
			this.lastImage.delete(context);
			void this.renderSlot(context);
		}, TRANSIENT_MS);
		this.transientTimers.set(context, timer);
	}

	// ---- now-playing poller ----

	private syncPoller(): void {
		const shouldRun = this.client !== null && this.slots.size > 0;
		if (shouldRun && !this.poller) {
			this.poller = setInterval(() => void this.pollNow(), POLL_MS);
			void this.pollNow();
		} else if (!shouldRun && this.poller) {
			clearInterval(this.poller);
			this.poller = null;
		}
	}

	private async pollNow(): Promise<void> {
		if (!this.client) return;
		try {
			this.now = await this.client.now();
		} catch {
			// Keep the last known state — a transient poll failure shouldn't flicker the highlight.
			return;
		}
		await this.renderNowDependent();
	}
}
