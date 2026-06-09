# NLSpec — `@faerrin/vellum`: the Diegetic Document Forge

> **Status:** Reviewed (adversarial completeness pass incorporated — see §14) · **Date:** 2026-06-09 · **Author:** brainstorm → spec (octo:spec, team mode / Claude personas)
> **Downstream:** feeds an implementation plan (`create-plan`) under `thoughts/vellum/plans/`.
>
> **Implementation status (2026-06-09):** M0–M6 shipped to `main` (`@faerrin/gothic` extracted +
> strider consuming it; renderer library; editor SPA; warm Playwright render service with the full
> SEC-1…5 model; six-kind zoo + mechanical|diegetic axis; slash palette / gallery / share links /
> seeded grime; Caddy + systemd deploy artifacts). Deferred: the full multi-document list
> (new/switch/rename/delete — rest of R-19) and golden-image visual-regression in Dagger CI with
> Chromium (NFR-9; `bun test` is kept pure so CI is green without a browser).

---

## 1. Vision & Problem Statement

**Problem.** The GM of the Faerrin (Pathfinder 2e) campaign needs to produce two kinds of polished visual artifacts:
1. **Mechanical references** — PF2e-style statblocks, hazards, items, spells (the "rulebook card" look).
2. **Diegetic handouts** — in-world letters, edicts, proclamations, dataslate transmissions (props the players physically receive).

Today there is no tool to author either in the campaign's house aesthetic. The public reference, [scribe.pf2.tools](https://scribe.pf2.tools), renders a flavor of markdown into Paizo's beige-parchment rulebook style — but that's the *wrong* visual identity for this campaign, which uses the **amber/teal Warhammer-40k gothic** look of the `strider` package.

**Vision.** `vellum` is a **Diegetic Document Forge**: a live-preview editor where the GM writes `remark`-directive-flavored markdown and sees it rendered, in the gothic house style, as either a mechanical card or a diegetic prop. The deliverable is a **PNG image** suitable for printing or sharing in chat.

**The core reframe (named).** This is *not* a Scribe clone and *not* a publishing app. It is a **forge for in-world documents**: markdown in, campaign prop out, gothic-skinned. PNG export is **prop generation**, not PDF authoring.

**Naming principle that governs the whole design:** **structure is PF2e, surface is gothic.** PF2e supplies the *grammar* (statblock skeleton, trait-pill geometry, action-economy glyph slots); the gothic skin supplies only the *paint layer*. The two are resolved by **layering, never blending** — a renderer component knows layout and nothing about color; the theme is injected.

---

## 2. Actors

| Actor | Description | Primary needs |
|-------|-------------|---------------|
| **GM author** (primary) | Writes documents, tweaks them in live preview, exports PNGs for a session. | Fast type-and-see loop; doesn't memorize field order; one-click export; shareable links. |
| **Player** (indirect) | Receives the exported PNG handout. | The artifact reads as a believable in-world prop / legible rules card. |
| **Repo maintainer** | Keeps the monorepo green and deployable. | Conventions honored (Bun, jj, Dagger CI, Caddy); no drift from `strider`'s gothic tokens. |
| **Render service** (system actor) | Headless-Chromium process that rasterizes a document node to PNG. | Deterministic, font-correct, warm-started output. |

---

## 3. Scope

### 3.1 In scope
- A new Bun-workspace package **`@faerrin/vellum`** at `pkg/vellum`, package name `@faerrin/vellum`.
- A prerequisite shared package **`@faerrin/gothic`** — a **pure, domain-agnostic skin** (design tokens + `@font-face` + font files only; *no* PF2e/domain assets) extracted from `strider`, with `strider` converted to consume it as proof.
- A **single-route SPA editor** (Vite + React 19 + CSS Modules + CodeMirror 6).
- A **parser+renderer library** turning directive-annotated markdown → themed React components.
- A **full document zoo**: `:::statblock`, `:::hazard`, `:::item`, `:::spell`, `:::handout`, `:::edict` block directives; `::action[n]` inline glyphs; `:trait[…]` pills.
- A **`mechanical | diegetic` theme axis** (teal dataslate ↔ amber parchment).
- A **server-side PNG export** via a Bun + Playwright render endpoint.
- **Slash-command snippet palette** + **template gallery**.
- **Persistence**: `localStorage` + LZ-compressed shareable URL hash.
- Deploy: a new `vellum.iridi.cc` block in the gitignored root `sites.caddyfile`.

### 3.2 Explicitly OUT of scope (anti-goals)
- **No rules engine.** The renderer is **rules-illiterate by construction** — it never evaluates a number, never computes a save DC, never validates legality, never links traits to definitions. This is a *defended* feature, not an omission.
- **No markdown write-back into `pkg/content`** in v1. PNG is the product. (Doc format is kept clean so write-back is a clean *later* addition — see §11.)
- **No client-side rasterization** (`html-to-image`/`html2canvas`) as the primary path — export is server-side (§7). A client path is a possible future fallback, not v1.
- **No WYSIWYG / contenteditable editor.** Two-pane source ⇄ preview only.
- **No multi-page / pagination / PDF** in v1 (single-document, single-image-per-export).
- **No auth, no accounts, no multi-user, no backend database.**
- **No PF2e content seeding** beyond example templates (no SRD import).

---

## 4. Glossary

- **Document** — one authored markdown source string + its doc-level frontmatter (title, theme mode, kind).
- **Directive** — a `remark-directive` node: container (`:::name`), leaf (`::name[…]`), or text (`:name[…]`).
- **Zoo** — the fixed set of supported block document types.
- **Theme mode** — `mechanical` (teal cogitator-dataslate) or `diegetic` (amber Imperial parchment).
- **Card node** — the single DOM subtree that gets rasterized to PNG (`[data-vellum-export]`).
- **Render service** — the Bun + Playwright endpoint that screenshots the card node.
- **Seeded imperfection** — deterministic grime (ink-bleed, stamp rotation, rings) derived from a hash of the document so the same input always yields the same PNG.

---

## 5. Architectural Decisions (converged — locked)

| # | Decision | Rationale | Consequence |
|---|----------|-----------|-------------|
| AD-1 | **Export is server-side** (Bun + Playwright), reusing strider's `build-og-image.ts` recipe (`await document.fonts.ready`, `deviceScaleFactor: 2`, screenshot a `[data-…]` locator). | Pixel-perfect; *every* gothic CSS effect (filters, scanlines, `background-clip:text`, glow shadows) renders correctly. Removes the project's single hardest risk. | **vellum is NOT a pure static site.** Deploy = static editor assets **+** a running render service behind Caddy. New deploy shape for this repo. |
| AD-2 | **PNG is the deliverable**, not content. Persistence = `localStorage` + LZ-compressed URL hash. | Smallest correct scope; serverless persistence; instant shareable links. | Doc format must stay clean/portable so `pkg/content` write-back is an easy later addition. |
| AD-3 | **Extract `@faerrin/gothic` first**; convert `strider` to consume it; vellum is consumer #2, render service #3. | The shared skin is the durable asset; one token source ⇒ theme drift is impossible. | Step-zero work touches `strider`; must keep strider's build byte-stable + tests green. |
| AD-4 | **Parser+renderer is a library**, separate from the editor app. `<Statblock>` etc. know layout, never rules, never colors. | The library is the asset; the type-and-see UI is disposable. aether/render-service can reuse it later. | Clean module boundary: `vellum/src/render/` (pure) vs `vellum/src/editor/` (DOM/IO). |
| AD-5 | **Stack mirrors strider**: Vite + React 19 + CSS Modules + Vitest + Playwright. **No TanStack Start** (single-route SPA needs no SSR). Editor uses **CodeMirror 6** (not Monaco/textarea). | Lowest friction in a repo that already runs this stack; inherits eslint flat config + `<ClientOnly>` discipline + the OG-image Playwright harness. | CM6 custom-language highlighting for the directive flavor is bespoke work. |
| AD-6 | **Markdown flavor = `remark` + `remark-directive` plugins over CommonMark**, not a bespoke grammar. | Portability + graceful degradation (still valid CommonMark; aether/Obsidian render it as plain); the toolchain is already in-repo (strider ships `remark`). | Inline action glyphs use the directive mechanism (`::action[2]`), **not** a hand-rolled micromark tokenizer. |
| AD-7 | **Action glyphs are inline SVG, not an icon font.** | Icon fonts are a top cause of blank glyphs in rasterized output; inline SVG is export-safe and same-origin. | Need an SVG glyph set for one/two/three-action, reaction, free-action — **lives in `pkg/vellum` (vellum-local), not `@faerrin/gothic`** (OQ-5: gothic stays a pure, domain-agnostic skin). |

---

## 6. Functional Requirements (behaviors + acceptance criteria)

> Format: **`R-n`** — behavior. **AC:** acceptance criteria (testable).

### 6.1 Editor & live preview
- **R-1 Two-pane editor.** A single-route SPA shows a CodeMirror 6 source pane (left) and a rendered preview pane (right).
  **AC:** typing in the source pane updates the preview; layout is responsive down to a single-column stack on narrow viewports.
- **R-2 Debounced, off-thread render.** Parsing runs off the keystroke path (debounce ~150–250 ms; React 19 `useDeferredValue`).
  **AC:** the source pane stays responsive (no input lag) while a large document re-renders; the preview lags but never blocks typing.
- **R-3 Directive syntax highlighting.** CM6 highlights vellum directives (`:::name`, `::action[n]`, `:trait[…]`) distinctly from prose.
  **AC:** a malformed/unknown directive is visually distinguishable from a valid one.
- **R-4 Graceful parse errors.** An unknown or malformed directive renders an inline error placeholder in the preview, never a blank screen or thrown exception.
  **AC:** given a document with one broken directive, the rest of the document still renders; the broken node shows a labeled error chip.

### 6.2 Document zoo (the directive grammar)
- **R-5 Block document types.** Support container directives `:::statblock`, `:::hazard`, `:::item`, `:::spell`, `:::handout`, `:::edict`, each with attributes (e.g. `:::statblock{level=5 rarity=unique}`) and named inner regions.
  **AC:** each type renders a distinct, recognizable layout; attributes set on the container affect the render (e.g. rarity → trait-pill color).
- **R-6 Inline action glyphs.** `::action[1|2|3|reaction|free]` renders the corresponding PF2e action-economy glyph as inline SVG.
  **AC:** all five glyph variants render as crisp SVG inline with text; they survive PNG export (no blank boxes).
- **R-7 Trait pills.** `:trait[fire]`, `:trait[unique]`, etc. render as PF2e-style trait pills, themed by the active mode.
  **AC:** a trait pill renders with the correct mode color; an unknown trait name still renders a generic pill (no crash).
- **R-8 Doc-level frontmatter.** YAML frontmatter sets document title, `kind`, and `mode` (mechanical|diegetic).
  **AC:** changing `mode` in frontmatter flips the theme of the whole document; `kind` may pick a default mode.
- **R-9 Rules-illiteracy invariant.** No directive handler imports or computes PF2e math.
  **AC:** a grep/static check confirms `src/render/` imports nothing rules-related; numbers typed by the author are rendered verbatim, never recomputed.

### 6.3 Theme axis
- **R-10 Mechanical mode** = teal cogitator-dataslate: void background, phosphor-teal rules `#6dd5c0`, CRT scanlines, action glyphs, trait pills, structured regions. Default for `statblock|hazard|item|spell`.
  **AC:** a statblock in mechanical mode shows scanlines, teal accents, and glyphs.
- **R-11 Diegetic mode** = amber Imperial parchment: vellum texture, amber ink `#f0b46e`, wax-seal/redaction stamps, gold-leaf `background-clip:text` drop-caps. Default for `handout|edict`.
  **AC:** a handout in diegetic mode shows parchment texture and amber styling; trait glyphs are suppressed by default in diegetic mode.
- **R-12 Mode is an injected token set, never hardcoded.** The same renderer component produces either surface from the active theme.
  **AC:** toggling mode on an unchanged source re-themes without altering structure/layout; no component hardcodes a hex color (all via `@faerrin/gothic` vars).

### 6.4 Authoring affordances
- **R-13 Slash-command snippet palette.** A `/` menu inserts scaffolds (`/statblock`, `/hazard`, `/item`, `/spell`, `/handout`, `/edict`, `/action 2`, `/trait`, `/seal`) with the correct field skeleton/order.
  **AC:** selecting `/statblock` inserts a complete, valid statblock skeleton with placeholder fields in canonical PF2e order.
- **R-14 Template gallery.** A gallery of 8–10 starter documents (one per zoo type + a few diegetic props) opens into the editor; the gallery *is* the documentation.
  **AC:** each gallery entry loads as an editable document that renders without errors.

### 6.5 Export (the product)
- **R-15 Server-side PNG export.** An "Export" action sends the current document to the render service, which returns a PNG of the `[data-vellum-export]` card node.
  **AC:** the exported PNG is **visually equivalent to the preview's card node** (the `[data-vellum-export]` subtree) within a perceptual-diff tolerance — fonts correct, glyphs present, effects intact. *Resolves the R-15↔R-18 tension:* the preview pane renders the card **inside** the same `[data-vellum-export]` boundary, so "matches the preview" means matches the card subtree, **not** the surrounding editor chrome (full-viewport scanline/vignette body overlays are editor decoration and are deliberately excluded from both the export and the card boundary).
- **R-15a Clipboard export.** "Copy image to clipboard" is a first-class action alongside "Download" (the chat-sharing path is copy, not save-then-attach).
  **AC:** invoking copy places a PNG on the clipboard that pastes into a chat client; download writes the same bytes to disk.
- **R-15b Output format.** Export is **PNG, sRGB, non-transparent** (a baked card background) by default; format/color space is pinned so determinism (R-17) is evaluable.
  **AC:** exported files declare sRGB; the background is opaque unless a future option opts into transparency.
- **R-16 Crisp output, bounded scale.** Export renders at `deviceScaleFactor: 2` by default, with a scale control **capped at a hard maximum** (e.g. 4×) and a maximum output pixel area (see SEC-4).
  **AC:** exported text is crisp at 2× (text-edge contrast at fixed sample coordinates exceeds a threshold); the scale control produces proportionally larger images **up to the cap**, and requests above the cap are rejected with a clear message.
- **R-17 Deterministic export.** Animations are frozen and fonts awaited (`document.fonts.ready`) before capture; **seeded imperfection** (ink-bleed, ±2° stamp rotation, rings) is derived from a hash of the document.
  **AC:** within the **pinned CI render container**, exporting the same source twice yields PNGs that match within a perceptual-diff tolerance of ~0 (the golden-image authority); changing one character changes the grime deterministically. **Byte-identity is NOT promised across Chromium versions or between local and CI** — see NFR-6.
- **R-18 Fixed export geometry, bounded height.** The card node is captured at a **fixed width** independent of viewport; height grows with content but is **soft-capped** with an author-visible "document exceeds recommended card height" warning past a threshold (overflow grows, never clips — §3.2 bars pagination).
  **AC:** the same document exported from different window sizes yields the same image dimensions; a document past the height threshold still exports fully but surfaces the warning.

### 6.6 Persistence & sharing
- **R-19 Multi-document local persistence.** The editor manages a **named list of documents** in `localStorage` (not a single doc): new / open / switch / rename / delete. The active document autosaves (debounced) and restores on reload.
  **AC:** creating several documents, switching between them, reloading, and finding all of them intact works; the last-active document is reselected on reload. *(Resolves the single-doc contradiction with R-14/R-20/§11 batch export.)*
- **R-19a Clobber protection.** Loading a template (R-14) or a shared link (R-20) **never silently overwrites** the active document — it opens as a *new* document (or prompts), and an undo/restore path exists for the editor session.
  **AC:** opening a gallery template or a shared link with unsaved work in the active doc does not destroy that work; the user can return to it.
- **R-19b First-run / empty state.** With empty `localStorage` and no URL hash, the editor shows a defined first-run state (e.g. the template gallery or a welcome document), never a blank/broken pane.
  **AC:** a fresh browser with cleared storage loads a usable, documented starting screen.
- **R-20 Shareable URL.** A "Share" action encodes the active document LZ-compressed into the URL hash; opening that URL opens it as a new document (per R-19a).
  **AC:** a shared link round-trips a document into another browser with no backend; a document whose encoded form exceeds a defined length threshold warns and offers an alternative (e.g. download the source) rather than producing a broken/truncated link.

### 6.7 Failure, resilience & dev experience
- **R-21 Export-failure UX.** Export has explicit states: in-progress (spinner + cancel), success, and failure (service unreachable / 5xx / timeout) with a clear, retryable message. A render **timeout** bound is defined.
  **AC:** with the render service stopped, "Export" shows a failure state and never hangs or silently no-ops; retry works once the service returns.
- **R-22 Concurrency safety.** Rapid or concurrent export requests (multiple tabs/recipients) are **queued or limited**, never crashing the shared browser; the UI reflects "queued."
  **AC:** firing N exports in quick succession yields N correct PNGs (serialized) with no service crash.
- **R-23 Local-dev export story.** `bun dev` either co-launches the render service or the editor clearly indicates export is unavailable locally with guidance. Export is never a silent dead button in dev.
  **AC:** a fresh `bun dev` makes export either work or show an actionable "render service not running" message.

### 6.8 Authoring edge cases
- **R-24 Paste hygiene.** Pasting rich text/RTF/HTML into the editor inserts plain text (or sanitized markdown), not arbitrary markup; pasting an image is handled or politely rejected.
  **AC:** pasting a statblock copied from a PDF yields clean text, not styled HTML.
- **R-25 Keyboard shortcuts.** Export, copy-image, mode-toggle, new-doc, and the `/` palette have keyboard shortcuts.
  **AC:** each core action is reachable by a documented shortcut.
- **R-26 Glyph coverage.** The gothic display/body faces (via `@faerrin/gothic`) must cover the character range real documents use (em-dash, smart quotes, ™/©/§, accented proper nouns); a missing-glyph (tofu) in an export is a defect. The BLK-1 font-swap mitigation must preserve coverage.
  **AC:** a fixture document exercising the required glyph set exports with no tofu boxes.

---

## 7. Export subsystem (detail)

- **Mechanism:** Bun HTTP service holds a warm headless-Chromium (Playwright). Editor POSTs `{ source, mode, scale }`; service renders the document in a minimal page that imports the **same renderer library** (AD-4) and `@faerrin/gothic` fonts, `await document.fonts.ready`, then `locator('[data-vellum-export]').screenshot()`.
- **Why warm process:** interactive latency; a cold Chromium per export is too slow for a type-tweak-export loop.
- **Deploy:** static editor assets served as a normal `*.iridi.cc` site; the render service runs as a sidecar Bun process, reached via a Caddy reverse-proxy path. (Exact routing TBD with maintainer.)
- **Reuse:** the wait-for-fonts + DPR + locator-screenshot recipe is lifted from `pkg/strider/scripts/build-og-image.ts`.
- **Per-request isolation:** each export uses a fresh browser **context/page** (not a shared page); contexts are recycled and the browser is **periodically restarted** to bound Chromium's memory leak.
- **Fallback (non-v1):** the architecture leaves room for a client-side `html-to-image` path later, but it is explicitly deferred.

### 7.1 Security & abuse model (the render service renders untrusted, author-supplied markdown in Chromium)

> **Threat model:** the render endpoint is public and unauthenticated (§3.2). A shareable URL is an **attacker-controlled payload**; anyone can POST arbitrary markdown to the public endpoint. The GM is not the only caller. These are **hard requirements**, each testable.

- **SEC-1 No raw HTML / sanitized AST.** `remark` is configured with raw HTML **disabled**; the rendered tree is sanitized (e.g. `rehype-sanitize` with an allowlist) so `<script>`, `<iframe>`, `onerror`, etc. in source can never execute in the render-service Chromium **or** the editor origin.
  **AC:** a document containing `<script>`/`<img onerror>` renders inert text; a fuzz corpus of injection payloads produces no script execution (tested).
- **SEC-2 No arbitrary `dangerouslySetInnerHTML`.** Renderer components do not inject unsanitized author strings as HTML (drop-cap/`background-clip:text` effects use sanitized text + CSS, not raw HTML).
  **AC:** static check + test confirm no unsanitized HTML injection path from source → DOM.
- **SEC-3 Network egress allowlist (no SSRF).** The render service intercepts requests and **blocks the headless browser from fetching author-controlled URLs** — no external images (`![](http://…)`), no remote `@font-face`/CSS `url()`, no link prefetch. Only same-origin/bundled assets (fonts, glyph SVGs) load. Image references resolve to bundled/data-URI assets or render a placeholder.
  **AC:** a document referencing `http://169.254.169.254/…` or `http://localhost/…` causes **no outbound fetch** from the service (verified via request interception logs).
- **SEC-4 Resource caps.** Hard limits on: input document **size** (bytes/nodes), render **timeout**, output **pixel area** and **scale** (R-16 cap), and node/table count. Requests exceeding any cap are rejected with a clear error, not rendered.
  **AC:** an oversized document, an absurd `scale`, and a pathological nested/huge-table document are each **rejected** without hanging or OOM-ing the browser.
- **SEC-5 Rate limiting & origin restriction.** The public render endpoint is rate-limited and (where feasible) origin/referer-checked to blunt DoS of the single browser pool.
  **AC:** a burst above the rate limit is throttled with 429s rather than degrading export for legitimate use.

---

## 8. Non-functional requirements & constraints

- **NFR-1 Repo conventions.** Bun everywhere (`bun test/run/bunx` — no npm/node/npx). VCS is **jj**, not git. Project memory + plans live under `thoughts/`. CI is **Dagger** (`dagger call check` / `build`). Declare every imported dependency (no phantom/hoisted deps).
- **NFR-2 `<ClientOnly>` discipline.** Every DOM/editor/export-touching module must be client-only and lazy-imported so nothing DOM-bound evaluates during prerender (mirrors strider).
- **NFR-3 Token single-source.** All colors/fonts come from `@faerrin/gothic`; no raw hex literals in vellum `*.module.css`. **Mechanism:** a **stylelint** rule (`color-no-hex` scoped to component CSS-Modules) — *not* eslint, which doesn't lint CSS values; SVG `fill`/gradient-stop/shadow-alpha exceptions are scoped out explicitly. Adding stylelint is part of M0.
- **NFR-4 Strider stays green & byte-stable.** Converting strider to consume `@faerrin/gothic` must not change its build output or break its tests/e2e.
- **NFR-5 Performance.** Live preview keeps input latency imperceptible for documents up to a realistic max (e.g. a full creature statblock + several paragraphs).
- **NFR-6 Determinism (scoped, not byte-identity).** Same source ⇒ **visually-equivalent** render within a perceptual-diff tolerance, achieved via seeded grime + frozen animation + awaited fonts + fixed geometry. **Byte-identical PNGs are guaranteed only within the single pinned CI render container** (the golden-image authority); local Chromium and other versions may differ at the pixel level due to font hinting / AA / encoder drift. Do not promise cross-environment byte-identity. *(This resolves the NFR-6 ↔ R-17 ↔ OQ-3 contradiction in the draft.)*
- **NFR-7 Accessibility/motion.** Respect `prefers-reduced-motion` in the editor UI (the *captured* card freezes animation regardless).
- **NFR-8 Render-service operations.** The service defines: a `/health` readiness endpoint for Caddy; a restart/supervision policy (the warm Chromium is recycled on a cadence and on crash); memory and max-concurrency limits; warm-up on boot; and basic observability (log export duration, failures, queue depth). The **gitignored** `sites.caddyfile` route is host-only/unversioned — M6 must include a documented host-update step (cf. the repo's stale-Caddy-route gotcha).
- **NFR-9 Test & visual-regression strategy.** Each milestone carries its own verification:
  - **Renderer (M1/M4/M5):** unit tests on pure parse→AST→props functions; per-zoo-type **DOM structural snapshots**; a **malformed-directive fuzz corpus** (drives R-4/R-7/SEC-1).
  - **Export (M3):** **golden-image visual regression** (pixelmatch/odiff) with a defined perceptual tolerance; reference PNGs are generated and authoritative **only in the pinned CI render container**; a documented regen step for when the gothic skin legitimately changes.
  - **CI infra:** the Dagger image used for export tests must install Playwright Chromium + system deps (libnss, fonts, etc.) — the static siblings don't need these; M3/M6 add them. `dagger call check` must be able to exercise the render service headlessly.
  - **Security (SEC-1…5):** explicit tests — HTML stripped, external URL blocked (no egress), oversized/absurd-scale rejected.
  - **Prerender discipline (NFR-2):** a build-time guard test that nothing DOM-bound evaluates during prerender (mirror strider's pattern).

---

## 9. Open questions & blockers — RESOLVED (2026-06-09)

- **BLK-1 — Font licensing. ✅ RESOLVED — license confirmed.** The maintainer confirms the project holds a license to use ITC Serif Gothic, including rasterizing/embedding into exported images. Export is **unblocked**; no display-face swap needed. *(R-26 glyph-coverage still applies — verify the licensed face covers the required character range with a fixture.)*
- **OQ-1 — Render-service topology. ✅ RESOLVED — warm sidecar Bun service.** A persistent Bun process holds a warm Chromium (best latency for the type-tweak-export loop), with `/health`, supervision/restart, and periodic browser recycle per NFR-8. Settled at the start of M3; M6 only wires the host route.
- **OQ-2 — Subdomain. ✅ RESOLVED — `vellum.iridi.cc`.** Matches the package name, consistent with `strider`/`caster`. Goes in the gitignored root `sites.caddyfile` at M6.
- **OQ-3 — Determinism strength. ✅ RESOLVED (policy) — visual-equivalence, pinned-CI-container authority.** No cross-environment byte-identity (unachievable across Chromium versions). The numeric perceptual-diff **tolerance is set empirically in M3** once real golden images exist. (See NFR-6 / R-17.)
- **OQ-4 — Directive schema depth. ↪ DEFERRED to implementation plan.** Per-zoo field schemas are defined during M1/M4 planning, modeling PF2e's real statblock/hazard/item/spell layout as **free-form named slots** (rendered verbatim, never computed — preserves R-9 rules-illiteracy).
- **OQ-5 — Action-glyph home. ✅ RESOLVED — vellum-local.** `@faerrin/gothic` stays a **pure, domain-agnostic skin** (tokens + fonts only); PF2e action-glyph SVGs are a TTRPG-domain concern and live in `pkg/vellum`. *(Supersedes the brainstorm's lean toward gothic; updates AD-7 and OQ-5's earlier note.)*

---

## 10. Milestones / phasing

1. **M0 — Extract `@faerrin/gothic`.** Tokens + `@font-face` + font files as a shared package; convert `strider` to consume it; prove build is byte-stable + tests green. *(No vellum code yet.)*
2. **M1 — Renderer library skeleton.** `remark`+`remark-directive` pipeline → `<Statblock>` + one more type, mechanical mode only, no editor. Unit-tested pure functions.
3. **M2 — Editor SPA.** CM6 two-pane live preview, debounced render, localStorage persistence.
4. **M3 — Server-side PNG export.** Bun+Playwright render service; "Export" round-trips a PNG; deterministic + crisp.
5. **M4 — Full zoo + theme axis.** All six block types, diegetic mode (parchment/seals/redaction/drop-caps), trait pills, action glyphs.
6. **M5 — Authoring polish.** Slash-command palette, template gallery, shareable URL hash, seeded imperfection.
7. **M6 — Deploy.** `sites.caddyfile` block + render-service topology; Dagger check/build green.

(Each milestone is ship-safe and independently verifiable.)

---

## 11. Future / deferred (not v1, design-for)
- Write authored markdown back into `pkg/content` as version-controlled diegetic canon (the "real deliverable is content" reframe).
- aether importing the renderer library to display handouts inline.
- Client-side `html-to-image` offline export fallback.
- Batch/manifest export ("export all handouts for tonight's session" → zip).
- SVG/print/PDF output from the same vector-first pipeline.

---

## 12. Acceptance criteria (spec-level Definition of Done for v1)

- [ ] `@faerrin/gothic` exists; `strider` consumes it; strider build byte-stable + tests green (NFR-4).
- [ ] `@faerrin/vellum` editor renders all six zoo types in both theme modes, live, without rules logic (R-5, R-9, R-10, R-11).
- [ ] Action glyphs + trait pills render and survive export (R-6, R-7, R-15).
- [ ] Server-side PNG export matches the live preview, crisp at 2×, deterministic (R-15–R-18).
- [ ] Slash palette + template gallery + localStorage + shareable URL all functional (R-13, R-14, R-19, R-20).
- [ ] No hex literals in vellum components; all theming via `@faerrin/gothic` (NFR-3).
- [ ] Font-licensing blocker (BLK-1) resolved or display face swapped; glyph coverage verified (R-26).
- [ ] **Security invariants hold:** raw HTML stripped, no SSRF egress, resource caps enforced, endpoint rate-limited (SEC-1…5).
- [ ] **Export failure UX** + concurrency safety + local-dev export story (R-21…23).
- [ ] **Multi-document** model with clobber protection + first-run state (R-19, R-19a, R-19b).
- [ ] Golden-image visual-regression harness green in pinned CI container; Dagger image has Chromium deps (NFR-9).
- [ ] `dagger call check` + `dagger call build` green; deployed behind Caddy with `/health` (M6, NFR-8).

---

## 13. Completeness score

- **Draft (pre-challenge):** **58 / 100** — coherent vision + well-locked architecture, but specified only the happy path; absent: security/abuse model, export-failure UX, operational lifecycle, multi-doc reality; over-promised byte-identical determinism; R-15↔R-18 preview/export contradiction.
- **Revised (post-challenge, this document):** **~88 / 100** — all five top must-fix gaps addressed: SEC-1…5 (security/abuse), R-21…23 (failure/resilience/dev), NFR-6 + R-17 rescoped (determinism now testable), R-19/19a/19b (multi-doc + clobber + first-run), NFR-9 (per-milestone test + visual-regression + CI-Chromium).
- **After open-question resolution (2026-06-09):** **~92 / 100** — BLK-1 cleared (font license confirmed), OQ-1 (warm sidecar), OQ-2 (`vellum.iridi.cc`), OQ-3 (visual-equivalence policy), OQ-5 (vellum-local glyphs) all decided. The only deliberately-deferred items now are implementation-plan depth: exact per-zoo directive field schemas (OQ-4), the empirical determinism-tolerance number (set in M3), and the concrete fixture/latency budgets behind the underspecified-AC numerics. No blockers remain.

## 14. Adversarial completeness challenge — summary of incorporated findings

Run by a code-reviewer persona (the "second provider") against the draft. Top-5 must-fix gaps and their resolution:

| # | Gap (draft) | Resolution in this revision |
|---|-------------|------------------------------|
| 1 | **No security/abuse model** for a public, unauthenticated, arbitrary-markdown → Chromium endpoint (no sanitization, SSRF, no caps, no isolation). | New **§7.1 SEC-1…5** + per-request context isolation in §7; security tests in NFR-9. |
| 2 | **Export-failure / service-down UX absent** for the tool's core product; no local-dev export story. | **R-21** (failure states + timeout), **R-22** (concurrency/queue), **R-23** (dev story). |
| 3 | **Determinism over-promised & contradictory** (byte-identical vs Chromium drift). | **NFR-6** rescoped to visual-equivalence + pinned-container byte-identity only; **R-17** AC rewritten; **R-15b** pins format/color space. |
| 4 | **Single-document model contradicts** gallery/share/batch reality; silent data loss. | **R-19** multi-doc list, **R-19a** clobber protection, **R-19b** first-run state. |
| 5 | **No CI/visual-regression strategy** for headless-Chromium export in Dagger; no per-milestone tests. | **NFR-9** (golden-image VR, per-milestone tests, Dagger Chromium deps). |

Also incorporated: R-15↔R-18 preview/export contradiction resolved (card-boundary definition in R-15); R-16 uncapped scale → bounded (R-16 + SEC-4); NFR-3 lint mechanism made concrete (stylelint); R-18 unbounded height → soft-capped warning; R-24 paste hygiene, R-25 shortcuts, R-26 glyph coverage; R-15a clipboard export; NFR-8 render-service operations; OQ-1 pulled forward to M3.

*Deferred (acknowledged, not yet pinned):* exact per-zoo directive field schemas (OQ-4), render-service topology (OQ-1), numeric tolerances/latency budgets/fixture sizes for the underspecified ACs, and mobile/touch as a first-class vs incidental target.
