/**
 * TranscriptPlayer — ported VERBATIM from quartz/components/scripts/transcript.inline.ts
 * into a Solid island (Phase 3). This is a progressive-enhancement island: it
 * renders NO markup of its own, it attaches behavior to the server-rendered
 * `.transcript-line` / `audio[data-transcript]` markup emitted by
 * src/lib/remark-transcript.mjs.
 *
 * Rebinding per the Phase-3 plan (docs/refactor-plan.md §10.1):
 *   • document.addEventListener("nav", …)  →  onMount  (Astro is MPA)
 *   • getFullSlug(window)                  →  document.body.dataset.slug
 *   • window.addCleanup(…)                 →  onCleanup (listeners + timer only;
 *     the SPA DOM-restore is dropped — the page unloads on navigation)
 *
 * DO NOT rewrite reactively: transcripts render to 1.2–1.4MB pages, so the
 * delegated-click + precomputed-seconds[] binary-search + single-root-class
 * filtering design is mandatory. getElementById is kept for `${second}-${user}`
 * ids (digit-leading / dotted → invalid CSS selectors).
 */
import { onCleanup, onMount } from "solid-js"

const SKIP_SECONDS = 10
const ARROW_SECONDS = 5

const icons = {
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18V6l-8.5 6 8.5 6zM11.5 12l8.5 6V6l-8.5 6z"/></svg>`,
  fwd: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18l8.5-6L4 6v12zM13 6v12l8.5-6L13 6z"/></svg>`,
  locate: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 100 8 4 4 0 000-8zm9 3h-2.06A7 7 0 0013 5.06V3h-2v2.06A7 7 0 005.06 11H3v2h2.06A7 7 0 0011 18.94V21h2v-2.06A7 7 0 0018.94 13H21v-2zm-9 6a5 5 0 110-10 5 5 0 010 10z"/></svg>`,
  prev: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 7l-5 5 5 5V7z"/></svg>`,
  next: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7v10l5-5-5-5z"/></svg>`,
  names: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`,
}

const fmt = (t: number) => {
  if (!Number.isFinite(t) || t < 0) t = 0
  const s = Math.floor(t % 60)
  const m = Math.floor((t / 60) % 60)
  const h = Math.floor(t / 3600)
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

/** Initialize the player against the current page. Returns a teardown fn or null. */
function initTranscriptPlayer(): (() => void) | null {
  const audio = document.querySelector("audio[data-transcript]") as HTMLAudioElement | null
  const lines = Array.from(document.querySelectorAll(".transcript-line")) as HTMLElement[]
  if (!audio || lines.length === 0) return null

  const root = lines[0].parentElement
  if (!root) return null
  root.classList.add("transcript-root")

  const seconds = lines.map((l) => Number(l.dataset.second))
  audio.controls = false

  const player = el("div", "transcript-player")
  const transport = el("div", "transcript-transport")

  const btn = (cls: string, label: string, svg: string) => {
    const b = el("button", cls, { type: "button", "aria-label": label, title: label })
    b.innerHTML = svg
    return b
  }

  const playBtn = btn("tp-btn tp-play", "Play", icons.play)
  const backBtn = btn("tp-btn", `Back ${SKIP_SECONDS}s`, icons.back)
  const fwdBtn = btn("tp-btn", `Forward ${SKIP_SECONDS}s`, icons.fwd)
  const locateBtn = btn("tp-btn tp-locate", "Jump to playing line", icons.locate)

  const scrubber = el("input", "tp-scrubber", {
    type: "range",
    min: "0",
    max: "100",
    step: "0.1",
    value: "0",
    "aria-label": "Seek",
  }) as HTMLInputElement
  const timeLabel = el("span", "tp-time")
  timeLabel.textContent = "0:00 / 0:00"

  transport.append(backBtn, playBtn, fwdBtn, scrubber, timeLabel, locateBtn)

  const search = el("div", "transcript-search")
  const searchInput = el("input", "tp-search-input", {
    type: "search",
    placeholder: "Search transcript…",
    "aria-label": "Search transcript",
  }) as HTMLInputElement
  const searchCount = el("span", "tp-search-count")
  const searchPrev = btn("tp-btn tp-search-nav", "Previous match", icons.prev)
  const searchNext = btn("tp-btn tp-search-nav", "Next match", icons.next)
  search.append(searchInput, searchCount, searchPrev, searchNext)

  const filterRow = el("div", "transcript-filter")
  const speakers = Array.from(new Set(lines.map((l) => l.dataset.user || "")))
    .filter(Boolean)
    .sort()
  const chips = new Map<string, HTMLButtonElement>()
  const chipLabels = new Map<string, HTMLElement>()
  for (const sp of speakers) {
    const chip = el("button", `tp-chip ${sp}`, {
      type: "button",
      "aria-pressed": "true",
      title: `Toggle ${sp}`,
    }) as HTMLButtonElement
    const dot = el("span", "tp-chip-dot")
    const label = el("span", "tp-chip-label")
    label.textContent = sp
    chip.append(dot, label)
    chip.addEventListener("click", () => {
      const hidden = root.classList.toggle(`hide-${sp}`)
      chip.setAttribute("aria-pressed", hidden ? "false" : "true")
    })
    chips.set(sp, chip)
    chipLabels.set(sp, label)
    filterRow.append(chip)
  }

  // ── Name toggle (character ↔ real) ────────────────────────────────
  // Lines carry both the real speaker (data-real) and the campaign character
  // (data-char). Default is character names; the choice persists per browser.
  // The control only appears when a session actually has character names (i.e.
  // it matched a campaign) — otherwise the two are identical and a toggle is
  // meaningless.
  const nameSpans = Array.from(root.querySelectorAll(".transcript-name")) as HTMLElement[]
  const hasCharacters = nameSpans.some((s) => (s.dataset.char ?? "") !== (s.dataset.real ?? ""))
  const spToChar = new Map<string, string>()
  for (const l of lines) {
    const u = l.dataset.user || ""
    if (u && !spToChar.has(u)) spToChar.set(u, l.dataset.char || u)
  }

  const NAMES_KEY = "transcript-names"
  let nameMode: "char" | "real" = localStorage.getItem(NAMES_KEY) === "real" ? "real" : "char"
  let namesBtn: HTMLButtonElement | null = null

  const applyNames = () => {
    for (const s of nameSpans) {
      const n = nameMode === "char" ? s.dataset.char : s.dataset.real
      s.textContent = `${n ?? ""}:`
    }
    for (const [sp, labelEl] of chipLabels) {
      labelEl.textContent = nameMode === "char" ? (spToChar.get(sp) ?? sp) : sp
    }
    if (namesBtn) {
      namesBtn.querySelector(".tp-names-label")!.textContent =
        nameMode === "char" ? "Characters" : "Real names"
      namesBtn.setAttribute("aria-pressed", String(nameMode === "char"))
      namesBtn.title =
        nameMode === "char"
          ? "Showing character names — click for real names"
          : "Showing real names — click for character names"
    }
  }

  if (hasCharacters) {
    namesBtn = el("button", "tp-names-toggle", { type: "button" }) as HTMLButtonElement
    namesBtn.innerHTML = `${icons.names}<span class="tp-names-label"></span>`
    namesBtn.addEventListener("click", () => {
      nameMode = nameMode === "char" ? "real" : "char"
      localStorage.setItem(NAMES_KEY, nameMode)
      applyNames()
    })
    filterRow.insertBefore(namesBtn, filterRow.firstChild)
  }
  // Sync labels (chips default to character names even before any click).
  applyNames()

  player.append(transport, search, filterRow)
  root.insertBefore(player, audio)
  player.insertBefore(audio, player.firstChild)

  const setPlayIcon = () => {
    const playing = !audio.paused && !audio.ended
    playBtn.innerHTML = playing ? icons.pause : icons.play
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play")
    playBtn.title = playing ? "Pause" : "Play"
  }

  let scrubbing = false
  const syncScrubber = () => {
    if (scrubbing) return
    const dur = audio.duration || 0
    scrubber.value = String(dur ? (audio.currentTime / dur) * 100 : 0)
    timeLabel.textContent = `${fmt(audio.currentTime)} / ${fmt(dur)}`
  }

  let activeIdx = -1
  const activeIndexFor = (t: number) => {
    let lo = 0
    let hi = seconds.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (seconds[mid] <= t) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans
  }

  let follow = false
  const updateActive = () => {
    const idx = activeIndexFor(audio.currentTime)
    if (idx === activeIdx) return
    if (activeIdx >= 0) lines[activeIdx].classList.remove("is-playing")
    activeIdx = idx
    if (idx >= 0) {
      lines[idx].classList.add("is-playing")
      if (follow) lines[idx].scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }

  const onTimeUpdate = () => {
    syncScrubber()
    updateActive()
  }

  audio.addEventListener("timeupdate", onTimeUpdate)
  audio.addEventListener("play", setPlayIcon)
  audio.addEventListener("pause", setPlayIcon)
  audio.addEventListener("ended", setPlayIcon)
  audio.addEventListener("loadedmetadata", syncScrubber)
  audio.addEventListener("durationchange", syncScrubber)

  const togglePlay = () => {
    if (audio.paused) void audio.play()
    else audio.pause()
  }
  playBtn.addEventListener("click", togglePlay)
  backBtn.addEventListener("click", () => {
    audio.currentTime = Math.max(0, audio.currentTime - SKIP_SECONDS)
  })
  fwdBtn.addEventListener("click", () => {
    audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + SKIP_SECONDS)
  })

  const onScrubInput = () => {
    scrubbing = true
    const dur = audio.duration || 0
    timeLabel.textContent = `${fmt((Number(scrubber.value) / 100) * dur)} / ${fmt(dur)}`
  }
  const onScrubChange = () => {
    const dur = audio.duration || 0
    audio.currentTime = (Number(scrubber.value) / 100) * dur
    scrubbing = false
  }
  scrubber.addEventListener("input", onScrubInput)
  scrubber.addEventListener("change", onScrubChange)

  const scrollToActive = () => {
    if (activeIdx >= 0) lines[activeIdx].scrollIntoView({ block: "center", behavior: "smooth" })
  }
  locateBtn.addEventListener("click", () => {
    follow = !follow
    locateBtn.classList.toggle("is-active", follow)
    locateBtn.setAttribute("aria-pressed", String(follow))
    locateBtn.title = follow ? "Following playback (click to stop)" : "Jump to playing line"
    scrollToActive()
  })

  // body[data-slug] replaces Quartz's getFullSlug(window); without it, deep links
  // would write `/undefined#…`. PageLayout.astro sets it on every page.
  const slug = document.body.dataset.slug ?? ""
  const seekTo = (second: number, user: string) => {
    if (!Number.isNaN(second)) audio.currentTime = second
    history.replaceState({}, "", `/${slug}#${second}-${user}`)
  }
  const onRootClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest("a")) return
    if ((window.getSelection()?.toString().length ?? 0) > 0) return
    const line = target.closest(".transcript-line") as HTMLElement | null
    if (!line || !root.contains(line)) return
    seekTo(Number(line.dataset.second), line.dataset.user || "")
  }
  root.addEventListener("click", onRootClick)

  let matches: HTMLElement[] = []
  let matchPos = -1

  const clearMatches = () => {
    for (const m of matches) m.classList.remove("search-match", "search-current")
    matches = []
    matchPos = -1
  }
  const showMatch = (pos: number) => {
    if (matches.length === 0) return
    if (matchPos >= 0) matches[matchPos].classList.remove("search-current")
    matchPos = (pos + matches.length) % matches.length
    const m = matches[matchPos]
    m.classList.add("search-current")
    m.scrollIntoView({ block: "center", behavior: "smooth" })
    searchCount.textContent = `${matchPos + 1} / ${matches.length}`
  }
  const runSearch = () => {
    clearMatches()
    const q = searchInput.value.trim().toLowerCase()
    if (q.length < 2) {
      searchCount.textContent = ""
      return
    }
    for (const line of lines) {
      const content = line.querySelector(".transcript-content")
      if (content && (content.textContent || "").toLowerCase().includes(q)) {
        line.classList.add("search-match")
        matches.push(line)
      }
    }
    if (matches.length === 0) {
      searchCount.textContent = "0 / 0"
    } else {
      showMatch(0)
    }
  }

  let searchTimer: number | undefined
  const onSearchInput = () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(runSearch, 180)
  }
  searchInput.addEventListener("input", onSearchInput)
  const onSearchKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      showMatch(matchPos + (e.shiftKey ? -1 : 1))
    } else if (e.key === "Escape") {
      searchInput.value = ""
      clearMatches()
      searchCount.textContent = ""
    }
  }
  searchInput.addEventListener("keydown", onSearchKeydown)
  searchPrev.addEventListener("click", () => showMatch(matchPos - 1))
  searchNext.addEventListener("click", () => showMatch(matchPos + 1))

  const isTyping = (t: EventTarget | null) => {
    const node = t as HTMLElement | null
    return !!node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA")
  }
  const seekLine = (delta: number) => {
    const idx = activeIdx >= 0 ? activeIdx + delta : 0
    const clamped = Math.max(0, Math.min(lines.length - 1, idx))
    const line = lines[clamped]
    seekTo(Number(line.dataset.second), line.dataset.user || "")
  }
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "/" && !isTyping(e.target)) {
      e.preventDefault()
      searchInput.focus()
      return
    }
    if (isTyping(e.target)) return
    switch (e.key) {
      case " ":
        e.preventDefault()
        togglePlay()
        break
      case "ArrowLeft":
        audio.currentTime = Math.max(0, audio.currentTime - ARROW_SECONDS)
        break
      case "ArrowRight":
        audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + ARROW_SECONDS)
        break
      case "j":
      case "J":
        seekLine(1)
        break
      case "k":
      case "K":
        seekLine(-1)
        break
      case "f":
      case "F":
        locateBtn.click()
        break
    }
  }
  document.addEventListener("keydown", onKeydown)

  const highlightHash = () => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return
    const target = document.getElementById(id)
    if (target) {
      target.classList.add("is-target")
      target.scrollIntoView({ block: "center" })
      window.setTimeout(() => target.classList.remove("is-target"), 2400)
    }
  }
  highlightHash()
  window.addEventListener("hashchange", highlightHash)

  setPlayIcon()
  syncScrubber()
  updateActive()

  // Teardown — listeners + timer only (MPA: the page unloads on navigation, so
  // the SPA DOM-restore that the original did is unnecessary).
  return () => {
    window.clearTimeout(searchTimer)
    audio.removeEventListener("timeupdate", onTimeUpdate)
    audio.removeEventListener("play", setPlayIcon)
    audio.removeEventListener("pause", setPlayIcon)
    audio.removeEventListener("ended", setPlayIcon)
    audio.removeEventListener("loadedmetadata", syncScrubber)
    audio.removeEventListener("durationchange", syncScrubber)
    scrubber.removeEventListener("input", onScrubInput)
    scrubber.removeEventListener("change", onScrubChange)
    root.removeEventListener("click", onRootClick)
    searchInput.removeEventListener("input", onSearchInput)
    searchInput.removeEventListener("keydown", onSearchKeydown)
    document.removeEventListener("keydown", onKeydown)
    window.removeEventListener("hashchange", highlightHash)
  }
}

export default function TranscriptPlayer() {
  let teardown: (() => void) | null = null
  onMount(() => {
    teardown = initTranscriptPlayer()
  })
  onCleanup(() => teardown?.())
  return null
}
