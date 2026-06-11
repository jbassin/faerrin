import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { BirdfeedController } from "../controller";
import type { SlotSettings } from "../settings";

/**
 * The one workhorse action. Users place it across the deck; the controller decides what each
 * instance shows (collection / tag / track / nav) based on the current navigation level and the
 * key's coordinates. This class is a thin shim that forwards lifecycle events to the controller.
 */
@action({ UUID: "com.faerrin.birdfeed.slot" })
export class Slot extends SingletonAction<SlotSettings> {
	constructor(private readonly controller: BirdfeedController) {
		super();
	}

	override onWillAppear(ev: WillAppearEvent<SlotSettings>): Promise<void> {
		return this.controller.onWillAppear(ev);
	}

	override onWillDisappear(ev: WillDisappearEvent<SlotSettings>): void {
		this.controller.onWillDisappear(ev);
	}

	override onKeyDown(ev: KeyDownEvent<SlotSettings>): Promise<void> {
		return this.controller.onKeyDown(ev);
	}
}
