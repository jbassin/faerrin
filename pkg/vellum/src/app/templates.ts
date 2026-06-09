/** R-14: starter documents. The gallery is the living documentation — people
 *  learn the flavor by editing examples, not reading a syntax reference. */
export interface Template {
  id: string;
  title: string;
  source: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "creature",
    title: "Creature statblock",
    source: `:::statblock[Vox-Thrall Acolyte]{level="Creature 2" traits="undead,mindless"}
A hollowed servitor wired to a vox-caster.

**Perception** +6; darkvision

## Actions
Strike :action[1] — a rusted ceremonial blade.
Litany of Static :action[2] — a wave of grinding noise.
Flinch :action[reaction] — when struck, the thrall recoils.
:::
`,
  },
  {
    id: "hazard",
    title: "Hazard / trap",
    source: `:::hazard[Censer of Choking Ash]{level="Hazard 3" traits="trap,fire"}
**Stealth** +12 (DC 22 to notice the pressure plate)

**Trigger** a creature steps on the censer's plate.
**Effect** the censer erupts, filling a 15-foot burst with searing ash.
:::
`,
  },
  {
    id: "item",
    title: "Item",
    source: `:::item[Cipher-Seal of the Second Cant]{level="Item 5" traits="magical,consumable"}
**Price** 25 gp

A wax seal that authenticates a transmission. Cracking it :action[1]
reveals whether a message bears the true cant.
:::
`,
  },
  {
    id: "spell",
    title: "Spell",
    source: `:::spell[Auspex Scan]{level="2" traits="divination,concentrate"}
**Cast** :action[2]
**Range** 60 feet

You sweep an auspex across the area. Learn the position of every
heat-source you can't see for 1 round.
:::
`,
  },
  {
    id: "handout",
    title: "Handout (diegetic)",
    source: `:::handout[+++ Inquisitorial Dispatch +++]
To the Lord-Captain, under seal:

The observatory has gone dark. Three cogitator-shrines remain unaccounted
for, last logged near :redact[Sub-Sector Coram]. Trust no transmission that
does not bear the second cipher.

— Interrogator Vael
:::
`,
  },
  {
    id: "edict",
    title: "Edict / proclamation",
    source: `:::edict[Proclamation of Tithe]
By order of the Administratum, all guilds of the lower spire shall render
unto the Cathedral one part in ten of their reclaimed promethium, that the
machine-spirits be appeased and the lamps kept lit.

Failure is heresy.
:::
`,
  },
];
