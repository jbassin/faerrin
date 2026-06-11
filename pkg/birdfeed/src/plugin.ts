import streamDeck from "@elgato/streamdeck";

import { Slot } from "./actions/slot";
import { BirdfeedController } from "./controller";

streamDeck.logger.setLevel("info");

const controller = new BirdfeedController();

streamDeck.actions.registerAction(new Slot(controller));

streamDeck.connect().then(() => controller.init());
