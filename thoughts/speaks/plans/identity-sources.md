# Identity sources — bot DB vs content (for Phase 3 reconciliation)

Reference for finalizing `services/speaks/players.toml`. Two sources describe the same
real campaign with different labels and details. **You pick the canonical values**; I then
wire the bot to read the finalized `players.toml`. Decoupled from content's pipeline, so
editing `players.toml` has **zero** live-site risk.

## Source A — bot Postgres (active campaign, what the bot displays today)

Active campaign: **"Faerrin"** (id 11), edition `pathfinder_2e`, not one-shot.

| player_id | Player | Discord snowflake(s) | username(s) | character | class | is_dm | is_admin |
|-----------|--------|----------------------|-------------|-----------|-------|-------|----------|
| 1 | Josh | 333321567926878209 | jbassin#8820 | The Godhome | gm | ✓ | ✓ |
| 2 | Jorge | 712150290169593856, 753011285003730955 | Kajymo#8050, Jorge Ipad#9322 | Argyle | champion | | |
| 3 | Mike | 555850241912602631 | Mike D#6187 | Benny | fighter | | |
| 4 | Noah | 652106046571020299 | nnaiman#4551 | Johnny | bard | | |
| 5 | Tanner | 417896818844893194 | TannerK#1952 | Anzu | psychic | | |
| 6 | S.C.H.I.S.M. | — (no Discord user) | — | (none in active campaign) | — | — | — |

The bot only actually **reads**: `player_name`, `character` (name), `class`, `edition`,
`player_id` (used as the dice-history key — 47M rows). `is_dm`/`is_admin` are currently
unread but carried for completeness.

## Source B — content `shibboleth.json` / `campaigns.yaml` (main campaign)

Main campaign (`isMain: true`): **"Through a Song, Darkly"**. No `class`/`is_dm` (content
doesn't track mechanics). `desc` shown for context (bot doesn't use it).

| Player | character(s) | desc (excerpt) |
|--------|--------------|----------------|
| Josh | **Gamemaster** | "the gamemaster for the session, controls all characters…" |
| Jorge | **Argyle**, **Arctos** | Argyle: failed celestial/repentant devil…; Arctos: an awakened polar bear… |
| Mike | Benny | nine-year-old android; son of Atum; full name Bennix |
| Noah | Johnny | half-elven; Ghosts of Raelion; blessed by the Watcher |
| Tanner | Anzu | a tengu; scion of the Qureshi family |

## Conflicts to resolve (you decide canonical)

1. **Campaign label:** "Faerrin" (bot) vs "Through a Song, Darkly" (content). Bot doesn't
   read the name, so cosmetic — but pick what the bot config should say.
2. **Josh's character:** "The Godhome" (bot) vs "Gamemaster" (content). The bot shows this
   in GM roll messages.
3. **Jorge:** bot active has only **Argyle**; content lists **Argyle + Arctos**. The bot
   needs exactly one character per player for a roll. Which one is canonical for the bot?
4. **Classes:** only the bot has them (gm/champion/fighter/bard/psychic). Confirm/correct.
5. **S.C.H.I.S.M. (player 6):** no Discord user, no active character — omitted from
   `players.toml`. Add a block if it should resolve to something.
6. **Player display-names** (Josh/Jorge/Mike/Noah/Tanner) already match content exactly —
   these stay as the SSOT join key with content. Don't change them.
