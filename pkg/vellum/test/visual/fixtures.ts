import type { ThemeMode } from "../../src/render/index.ts";

/** Golden-image fixtures (NFR-9). Cover both skins + a multi-kind layout. */
export interface VisualFixture {
  name: string;
  source: string;
  mode: ThemeMode;
  scale?: number;
}

export const FIXTURES: VisualFixture[] = [
  {
    name: "statblock-mechanical",
    mode: "mechanical",
    source: `:::statblock[Vox-Thrall Acolyte]{level="Creature 2" traits="undead,mindless"}
A hollowed servitor wired to a vox-caster.

## Actions
Strike :action[1] — a rusted blade.
Litany of Static :action[2] — grinding noise.
Flinch :action[reaction] — when struck.
:::`,
  },
  {
    name: "handout-diegetic",
    mode: "diegetic",
    source: `:::handout[+++ Inquisitorial Dispatch +++]
The observatory has gone dark. Three cogitator-shrines remain unaccounted
for, last logged near :redact[Sub-Sector Coram]. Trust no transmission.

— Interrogator Vael
:::`,
  },
  {
    name: "zoo-mechanical",
    mode: "mechanical",
    source: `:::hazard[Censer of Ash]{level="Hazard 3" traits="trap,fire"}
**Stealth** +12
The plate triggers a 15-foot burst of searing ash.
:::

:::spell[Auspex Scan]{level="2" traits="divination"}
**Cast** :action[2]
Learn the position of every heat-source for 1 round.
:::`,
  },
];
