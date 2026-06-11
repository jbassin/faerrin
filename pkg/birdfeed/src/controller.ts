/**
 * Central controller: owns per-device navigation state, the visible-slot registry, the lark client,
 * the now-playing poller, and all rendering. The Slot action is a thin shim that forwards events
 * here. This keeps every SDK-coupled concern in one place; the pure logic lives in grid/nav/render.
 */

import streamDeck, { type KeyAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { type DeviceShape, type GridData, type Role, coloredTagsPresent, layout, roleAt } from "./grid";
import { LarkClient, LarkError } from "./lark/client";
import type { Collection, NowPlaying, Tag, Track } from "./lark/types";
import { back, enterCollection, enterTag, rootNav, withPage, type NavState } from "./nav";
import { messageSvg, renderRole, type RenderOpts } from "./render/svg";
import { isConfigured, type BirdfeedGlobalSettings } from "./settings";

const POLL_MS = 2500;
const TRANSIENT_MS = 1800;
const DEFAULT_SHAPE: DeviceShape = { columns: 8, rows: 4 }; // XL fallback

interface SlotRef {
	action: KeyAction;
	deviceId: string;
	column: number;
	row: number;
}

interface DeviceState {
	shape: DeviceShape;
	nav: NavState;
	/** Colored tags present in the current collection. */
	tags: Tag[];
	/** All tracks in the current collection (the tag view filters these). */
	tracks: Track[];
}

export class BirdfeedController {
	private client: LarkClient | null = null;
	private collections: Collection[] = [];
	private collectionsLoaded = false;
	private now: NowPlaying | null = null;

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
		if (isConfigured(settings)) {
			this.client = new LarkClient({ origin: settings.larkOrigin, key: settings.larkKey });
		} else {
			this.client = null;
		}
		this.collectionsLoaded = false;
		this.collections = [];
	}

	private async reloadAndRenderAll(): Promise<void> {
		// Reset every device to root and repaint after a config change.
		for (const ds of this.devices.values()) {
			ds.nav = rootNav();
			ds.tags = [];
			ds.tracks = [];
		}
		await this.ensureCollections();
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
		if (!this.devices.has(deviceId)) {
			this.devices.set(deviceId, { shape, nav: rootNav(), tags: [], tracks: [] });
		} else {
			this.devices.get(deviceId)!.shape = shape;
		}

		await this.ensureCollections();
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
		// Drop device state when its last slot disappears.
		const deviceId = ev.action.device.id;
		if (![...this.slots.values()].some((s) => s.deviceId === deviceId)) {
			this.devices.delete(deviceId);
		}
		this.syncPoller();
	}

	async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const ref = this.slots.get(ev.action.id);
		const ds = ref && this.devices.get(ref.deviceId);
		if (!ref || !ds) return;
		if (!this.client) return; // unconfigured: keys show the "set up" message
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
				ds.nav = withPage(ds.nav, ds.nav.page + 1);
				return this.renderDevice(ref.deviceId);
			case "collection":
				ds.nav = enterCollection(role.id, role.name);
				await this.loadCollection(ds, role.id);
				return this.renderDevice(ref.deviceId);
			case "tag":
			case "navTag":
				ds.nav = enterTag(ds.nav, role.id, role.name);
				return this.renderDevice(ref.deviceId);
			case "track":
				return this.playTrack(ref, role.id);
			case "empty":
				return;
		}
	}

	private async playTrack(ref: SlotRef, trackId: number): Promise<void> {
		if (!this.client) return;
		try {
			this.now = await this.client.play({ trackId });
			await this.renderTracks();
		} catch (err) {
			const msg =
				err instanceof LarkError && err.status === 409
					? "Join a voice channel first"
					: err instanceof LarkError && err.status === 503
						? "lark bot offline"
						: "Play failed";
			await this.showTransient(ref.action.id, messageSvg(msg, "error"));
		}
	}

	// ---- data loading ----

	private async ensureCollections(): Promise<void> {
		if (!this.client || this.collectionsLoaded) return;
		const client = this.client;
		const gen = this.generation;
		try {
			const collections = await client.collections();
			if (this.generation !== gen || this.client !== client) return; // config changed mid-flight
			this.collections = collections;
			this.collectionsLoaded = true;
		} catch {
			if (this.generation !== gen) return;
			this.collections = [];
		}
	}

	private async loadCollection(ds: DeviceState, collectionId: number): Promise<void> {
		if (!this.client) return;
		const client = this.client;
		const gen = this.generation;
		try {
			const tracks = await client.tracks({ collection: collectionId, limit: 500 });
			if (this.generation !== gen || this.client !== client) return; // config changed mid-flight
			ds.tracks = tracks;
			ds.tags = coloredTagsPresent(tracks);
		} catch {
			if (this.generation !== gen) return;
			ds.tracks = [];
			ds.tags = [];
		}
	}

	private gridData(ds: DeviceState): GridData {
		return { collections: this.collections, tags: ds.tags, tracks: ds.tracks };
	}

	// ---- rendering ----

	private deviceShape(action: KeyAction): DeviceShape {
		const size = action.device.size;
		if (size && size.columns && size.rows) return { columns: size.columns, rows: size.rows };
		return DEFAULT_SHAPE;
	}

	private renderOptsFor(role: Role): RenderOpts {
		if (role.kind !== "track" || !this.now?.current || this.now.current.trackId !== role.id) return {};
		return {
			playing: this.now.status === "playing",
			paused: this.now.status === "paused",
			positionMs: this.now.current.positionMs,
			durationMs: this.now.current.durationMs,
		};
	}

	private async renderSlot(context: string): Promise<void> {
		const ref = this.slots.get(context);
		const ds = ref && this.devices.get(ref.deviceId);
		if (!ref || !ds) return;
		if (this.transient.has(context)) return;

		let image: string;
		if (!this.client) {
			image = messageSvg("Set lark URL + key in settings");
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

	/** Repaint only track keys (used by the now-playing poller). */
	private async renderTracks(): Promise<void> {
		const jobs: Promise<void>[] = [];
		for (const [context, ref] of this.slots) {
			const ds = this.devices.get(ref.deviceId);
			if (!ds || ds.nav.level !== "tag") continue;
			const role = roleAt(layout(ds.nav, ds.shape, this.gridData(ds)), { column: ref.column, row: ref.row }, ds.shape);
			if (role.kind === "track") jobs.push(this.renderSlot(context));
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
			// Keep the last known now-playing state — a transient poll failure shouldn't
			// drop (flicker) the highlight. The next successful poll corrects it.
			return;
		}
		await this.renderTracks();
	}
}
