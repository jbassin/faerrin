# Session Plan — Import `listener_wretch` into the Faerrin Monorepo

**Created:** 2026-06-04
**Intent Contract:** .claude/session-intent.md
**Status:** Plan only — not executed. Run `/octo:embrace` (or implement-plan) when ready.

---

## What You'll End Up With

`listener_wretch` living in-repo as **`pkg/listener`**, a Bun-workspace package whose orchestration
is TypeScript and whose only Python is a thin, self-contained **whisper transcription CLI**. It is
host-portable (env/derived paths, no `/emerald` hardcoding), the Discord-ID→name roster is unified to
a single source of truth, and the `shared-content` ingest reads its output **directly** instead of
over HTTP — with byte-identical `data/{date}.json` proven before the live cutover.

---

## The System Today (what we're importing)

**Pipeline (`process.py`, cron-driven via `process.sh`):**

1. **Watch + state** — scan `INCOMING_PATH` (`~/drive/Craig`) for Craig `.zip` recordings; dedupe
   against a `shelve` pickle DB (`data.pkl`). (`process.py:main`, `db.py`)
2. **Unzip + organize** — extract zip → temp; create `saved/{date}/`. (`file_utils.py`)
3. **Audio merge** — `pydub` overlays each player's `.aac` track into one `audio.mp3`. Needs
   **ffmpeg**. (`process.py:merge_sound_files`)
4. **Transcribe** — `whisperx.load_audio` → `transcribe` (Whisper large-v3, CPU/int8) → `align`
   (wav2vec2), per player track → per-user segment JSON. **The irreducible Python core.**
   (`process.py:transcribe`, `models.py`)
5. **Assemble script** — `SoundStack` time-merges all per-user segments into one ordered
   `script.json`. (`sound_stack.py`, `script.py`)
6. **Publish + cleanup** — move tracks into `saved/{date}/`, delete source zip; a static server
   exposes `saved/{date}/` at `https://static-audio.iridi.cc/{date}/`.
7. **Config** — `consts.py`: hardcoded `/emerald` paths + `PLAYERS` roster (Discord-ID → name).

**The monorepo seam (decoupled over HTTP):**

- `shared-content/scripts/pipeline/ingest.ts` lists `static-audio.iridi.cc`, finds each session's
  `script.json`, fetches it, and builds the `audio` URL `…/{date}/audio.mp3`. It then formats raw
  lines (`{start,end,user,text}`) → `data/{date}.json` (the committed, canonical transcript).
- `config.ts → remote.baseUrl = "https://static-audio.iridi.cc/"` is the exact seam the re-wire replaces.
- **Roster duplication:** `lib/roster.ts userToName` (`boiledpacakes→Jorge`, `miked6187→Mike`, …) is
  the inverse of `consts.PLAYERS` — same data, two languages.

**Moving parts to tame:** ffmpeg dependency · ~3GB whisper model download · `shelve` pickle state ·
Craig sync folder · cron job · hardcoded host paths · large audio/zip artifacts (must stay out of git).

---

## Recommended Approach: **Hybrid, staged** (vendor-first → hybridize → re-wire)

The two live options resolve cleanly when sequenced rather than chosen:

- **Vendor-as-is** is the fastest way to satisfy *minimal risk* + *kill host coupling* — but leaves a
  full Python package, working against *language uniformity*.
- **Hybrid** satisfies *language uniformity* (TS owns everything except the model call) — but is more
  work and riskier to do in one leap.

**So do vendor-as-is FIRST (Phase 1), then hybridize incrementally (Phase 2), then re-wire the seam
(Phase 3).** Each phase ships independently, is reversible, and keeps the workspace green. If you stop
after Phase 1 you still have a portable, in-repo, working pipeline; Phases 2–3 are pure upside on
uniformity and coupling.

**Recommendation: target the hybrid end-state, but gate each phase.** The whisper core (`transcribe`,
`models.py`) stays Python forever (per your decision); everything around it (watch, state, unzip,
audio merge, script assembly, publish, config) is mechanical and ports to TS without behavior change.

### Target layout

```
pkg/listener/
  package.json            # Bun workspace member: scripts wrap orchestration + `uv run` for transcribe
  CLAUDE.md               # local guidance (the "one Python member" exception, ffmpeg/model deps)
  src/                    # TS orchestration (Phase 2): watch, state, unzip, audio-merge(ffmpeg), soundstack, publish
  python/
    pyproject.toml        # uv project — whisperx + deps ONLY
    transcribe.py         # thin CLI: session dir of .aac in → per-user segment JSON out (model loads once)
  .env.example            # INCOMING_PATH, DATA_PATH, TMP_PATH, OUTPUT mode, etc.
  .gitignore              # data/, tmp/, *.zip, *.aac, *.mp3, models/, *.pkl
```

---

## How We'll Get There — Phased

### Phase 0 — Confirm host facts  ✅ DONE (2026-06-04)
**Confirmed:**
- ✅ Deps present on host: **ffmpeg 4.4.2**, **uv 0.11.19**, **python 3.11** (`.python-version`).
- ✅ **`/emerald` is a symlink → `/ruby`.** No path ambiguity — `consts.py`'s `/emerald` paths
  resolve to the same disk as `/ruby`. Still hardcoded (kill in Phase 1), but not pointing elsewhere.
- ✅ Craig incoming `~/drive/Craig` exists, currently **empty** (zips deleted post-process — expected).
- ✅ **Footprint: 36GB** — model **2.9GB**, `data/saved/` **27GB across 82 sessions** (~400MB/session;
  e.g. 2026-6-1 `audio.mp3` is 216MB). → gitignoring `data/` is **non-negotiable**.
- ✅ `shelve` state present (`data.pkl.{dat,dir,bak}`, 419KB, mtime Jun 2).
- ✅ **Cron:** `30 2 * * *` → `process.sh` (daily 02:30). Clean import: no `.git`/`.jj` in the project.
- ✅ **Output contract** (per `saved/{date}/`): per-player `N-<discordid>.aac`, `audio.mp3`,
  per-user `<id>~N.json`, `script.json`. Raw `script.json` line = `{start,end,text,words[],user}`
  with `user` = raw Discord ID; ingest uses only `start/end/user/text`.

**⚠️ Open items surfaced (resolve in Define / before Phase 3):**
- ✅ **`static-audio.iridi.cc` host — RESOLVED (user decision 2026-06-04):** audio is **safe to move**;
  the user will update the reverse proxy **out-of-band**. Phase 3 = listener writes `audio.mp3` to its
  in-repo (gitignored) served dir; we do NOT touch proxy config. The transcript `audio` URL contract
  stays as-is unless the user says the URL changes.
- ⚠️ **Transcript format drift — RESOLVED + flagged as pre-existing regression.** Verified against
  2026-5-21: the raw `script.json` already contains `" Jaws."` / `"Now you can hear me, Jaws."`
  (capitalized + punctuated); `ingest.ts` faithfully trims the leading space + applies corrections.
  So **casing comes from the model, and the transform is byte-faithful** (parity gate strategy holds).
  The 2026-6-1 **lowercase/unpunctuated** output is therefore an **upstream model/config change in
  `listener_wretch` itself** (note `consts.py` has `large-v3` with `distil-large-v3` commented) — a
  pre-existing quality regression, NOT caused by migration. ✅ **RESOLVED (user decision 2026-06-04):
  ACCEPT current output** as-is; revisit the whisperx model/settings *after* the migration.
- ⚠️ **Separate quartz cron** — `12 * * * *` builds `/emerald/.../quartz` (the OLD standalone repo),
  not the monorepo `pkg/quartz`. Out of scope here, but the live quartz deploy may still be pre-monorepo;
  flag for the deployment cutover.

### Phase 1 — Vendor as-is, made portable  ✅ DONE (2026-06-04)  *(satisfies: minimal risk, kill host coupling)*
**Shipped:** `pkg/listener/` created — Python vendored under `python/` (13 code/config files, no data);
`consts.py` now derives paths from package location with `LISTENER_*` env overrides (zero `/emerald`
hardcoding); `package.json` joins the `pkg/*` workspace with `process`/`script`/`clean` scripts (omits
typecheck/test/lint so it sits out those `bun --filter` runs); strict `.gitignore` guards the 36GB
`data/`+model+artifacts; `.env.example` + local `CLAUDE.md` (documents the deliberate Python exception).
**Gate passed:** workspace green (typecheck clean ×5 pkgs; 656 tests pass / 0 fail); Python modules
byte-compile; env-derivation + override verified; jj confirms no heavy artifacts tracked. Not yet committed.
1. Import the Python under `pkg/listener/python/` (clean copy — no git history to preserve).
2. Replace `consts.py` hardcoded paths with **env + derived defaults** (mirror `lib/paths.ts`:
   derive from package location, override via `.env`). Add `.env.example`.
3. Replace `process.sh` (sources `.bashrc`, `/emerald` paths) with a `package.json` script /
   `justfile` target invoking `uv run`.
4. Add `pkg/listener/.gitignore` for `data/`, `tmp/`, audio/zip/model/pkl artifacts.
5. Give it a `package.json` (joins `pkg/*` workspace) + a local `CLAUDE.md` documenting the
   **deliberate Python exception** and its system deps (ffmpeg, model, disk).
6. **Gate:** run it on one **new** Craig zip end-to-end on the host; confirm `script.json` +
   `audio.mp3` produced identically to today. Workspace still green.

### Phase 2 — Hybridize: TS orchestration around a Python whisper CLI  ✅ DONE (2026-06-04)  *(satisfies: language uniformity)*
**Shipped (commits `ffdc6697` logic core, `0225385f` orchestrator):** `src/process.ts` owns the
pipeline (watch → state via `data/state.json` replacing the shelve pickle → unzip → ffmpeg `amix`
audio merge replacing pydub → call `python/transcribe.py` → `SoundStack` assemble → publish to
`saved/{date}/`). `python/transcribe.py` is the lone Python step (whisperx, model loaded once per
batch). Roster unified: `isPlayer()` added to `shared-content/scripts/lib/roster.ts` (SSOT);
`src/roster.ts` re-exports it; `consts.PLAYERS` now only feeds the `process:py` fallback. Ported
`sound_stack.py`/`file_data.py` to TS with bun tests. `process` script → TS orchestrator; `process:py`
kept as fallback. **Verified:** 6-pkg typecheck green; 16 listener tests + full suite 0 fail; ffmpeg
`amix normalize=0` + libmp3lame confirmed on host; orchestrator smoke-runs clean on empty incoming.
**⏳ Pending host validation:** real end-to-end whisper run against a Craig `.zip` (the slow CPU step)
— folds into the Phase 3 parity gate. Open robustness note: `amix` assumes homogeneous track formats
(true for Craig); add `aresample` only if a real session proves otherwise.
7. Carve the Python down to **`transcribe.py`**: a CLI taking a session's `.aac` files and emitting
   per-user segment JSON. **Model loads once per session invocation** (don't reload the 3GB model
   per file — preserve the `run_once` behavior at the session level).
8. Port orchestration to TS in `pkg/listener/src/`:
   - watch/state: replace `shelve` pickle with a JSON file or `bun:sqlite` (state is near-disposable —
     processed zips are deleted, so a fresh start is low-risk; document this).
   - unzip (node/bun), audio merge (**shell out to ffmpeg directly**, dropping `pydub`), `SoundStack`
     (trivial TS port), publish/cleanup.
9. TS calls `uv run python/transcribe.py <session-dir>` for step 4 only.
10. **Unify the roster:** make `shared-content/lib/roster.ts` the SSOT; have listener read the same
    mapping (export a small JSON/TS the Python CLI can also read) instead of its own `PLAYERS`.
11. Typecheck/test the new TS package; add unit tests for `SoundStack` and the date/username parsing
    (`file_data.py` logic is fiddly and worth pinning).
12. **Gate:** new session through the hybrid path yields a `script.json` equivalent to the Python path.

### Phase 3 — Re-wire the ingest seam  ✅ CORE DONE (2026-06-04)  *(satisfies: re-wire into the build — behind a parity gate)*
**Shipped:** `ingest` now has a switchable source (`config.ingest.source`, env `INGEST_SOURCE`,
default `remote` = no behavior change). `source=local` reads each session's `script.json` straight
off `listener`'s `saved/` dir (`INGEST_SAVED_DIR`) via a new `getLocalListing()` that shares the exact
same format transform as the remote path; audio URL stays `static-audio.iridi.cc` (mp3 stays out of git).
**🎯 PARITY GATE PASSED:** ran `INGEST_SOURCE=local` against the 81-session `listener_wretch/data/saved`
→ wrote 75 sessions → **0 modified, 0 added** vs the committed `data/*.json` (byte-identical). Full
workspace green (6 typecheck; all suites 0 fail). quartz 763-file check not needed (default unchanged,
data byte-identical, renderer untouched) — it belongs to the live cutover.
**Remaining for cutover (Phase 4-adjacent):** flip the default to `local` once `listener` writes to the
real saved dir on the host; audio host move (user, out-of-band). Original Phase 3 steps below for ref.
13. Add listener output as a **local source** the pipeline can read: either a new `run.ts` step that
    runs listener, or point `ingest` at a local `saved/` dir instead of `remote.baseUrl`.
14. Make ingest's source **configurable** (local vs HTTP) so cutover is a flag flip, not a rewrite.
15. **Parity gate (live-site safety):** run re-wired ingest, diff `shared-content/scripts/data/*.json`
    against the committed files — must be **byte-identical** for existing sessions. Then build quartz
    and confirm the **763-file** set is unchanged.
16. Audio: keep serving `audio.mp3` as static files (per Phase 0 decision); update only the transcript
    source, leaving the audio URL contract intact unless Phase 0 chose otherwise.
17. Cut over (flip the flag); keep the HTTP path available as fallback for one cycle. Update
    `sites.caddyfile` only if audio hosting moves (it's gitignored — edit on host).

### Phase 4 — Operationalize & document  ✅ IN-REPO DONE (2026-06-04)  *(host execution = user-owned)*
**Shipped (`03e42f02`):** `reconcile()` → `downstream.sh` (full cascade: wiki pipeline + quartz build
→ caster podcast via date→session-id resolver, free edge TTS default). `deploy/` = systemd
`.path`+`.service` templates + `CUTOVER.md` runbook. Knobs: `LISTENER_SKIP_DOWNSTREAM`,
`LISTENER_DOWNSTREAM_CMD`, `CASTER_TTS_PROVIDER`, `SKIP_PODCAST`. Workspace green (19 listener tests).
**Host steps remain user-owned** (validate whisper run → install units + linger → repoint/retire crons
→ `LISTENER_DATA_PATH` at 27GB store → audio proxy move → decommission). Original notes below for ref.
18. Move the cron job to reference the new in-repo location (documented unit; or a monorepo script).
19. Update root `CLAUDE.md` (package table + the Python-exception gotcha) and `shared-content`
    CLAUDE.md (ingest now local-first). Write `pkg/listener/CLAUDE.md`.
20. Decommission `/ruby/data/experiments/listener_wretch` once the in-repo path runs a full real cycle.

---

## Phase Weights (octo)

```
DISCOVER  ██████ 15%   Host facts (Phase 0); largely done — codebase already mapped
DEFINE    ██████████ 25%   Lock hybrid-vs-vendor staging, parity contract, env schema, roster SSOT
DEVELOP   ████████████████ 40%   Phases 1–3 porting (Python→portable, orchestration→TS, re-wire)
DELIVER   ████████ 20%   Parity gates, quartz 763-file diff, workspace green, cutover w/ fallback
```

## Debate / Decision Checkpoints

- 🔸 **After Define:** "Vendor-as-is as the end state, or push all the way to hybrid?" (effort vs.
  uniformity — Phase 1 is a valid stopping point).
- 🔸 **Phase 0:** audio hosting — keep `static-audio.iridi.cc` vs. Caddy-serve a local dir.
- 🔸 **Before Phase 3 cutover:** parity gate must pass (byte-identical `data/*.json` + 763-file quartz build).

---

## Key Risks

- **Whisper non-determinism** → never re-transcribe history; parity is on the *pipeline transform*
  and *new* sessions only. Historical `data/*.json` is already canonical and committed.
- **Large artifacts in git** → strict `.gitignore`; audio/zip/model/pkl never tracked.
- **Model reload cost** → transcribe per session, not per file (keep `run_once` semantics).
- **Live ingest path** → keep HTTP source as a switchable fallback through cutover.
- **`jj`, not git** → all moves/adds via `jj` (see `jj` skill); listener_wretch has no history to port.
- **Host-path ambiguity** → `consts.py` says `/emerald` but project lives under `/ruby`; confirm live values in Phase 0.

## Provider Requirements

🔴 Codex CLI: Not installed ✗   🟡 Gemini CLI: Not installed ✗   🟤 OpenCode: Not installed ✗
🔵 Claude: Available ✓ — multi-perspective via `octo:personas:*` agents (this repo's convention; see
memory `octo-personas-not-llms`). Useful personas here: `cloud-architect` (audio hosting / cutover),
`python-pro` (transcribe CLI), `code-reviewer` (parity gate).

## Execution

```bash
/octo:embrace "import listener_wretch into the monorepo per .claude/session-plan.md"
# or run phases as discrete implement-plan passes (Phase 1 is independently shippable)
```

## Next Steps
1. Review this plan.
2. Decide the Phase-1 stopping question (vendor-only vs. full hybrid) — or defer to the Define gate.
3. Execute when ready (start with Phase 0 host-fact confirmation).
