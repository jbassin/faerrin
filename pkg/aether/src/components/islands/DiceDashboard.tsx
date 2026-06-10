/**
 * /dice dashboard — Solid island visualizing mouth's historical roll data
 * (plan: thoughts/aether/plans/0001-dice-data-webui.md).
 *
 * Mounted client:only="solid" (ECharts touches canvas/DOM). Fetches the static
 * artifacts the exporter wrote to /dice/ (summary.json eager; rolls.json lazily
 * for the table). Degrades to a friendly notice when no export exists yet.
 *
 * Colors are read from the wiki's CSS custom properties (per-player --text<Name>,
 * teal --secondary, amber --tertiary) so charts match the void theme and follow
 * the `themechange` event like Graph.tsx.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import * as echarts from "echarts"
import type { BaseStats, DiceRoll, DiceSummary } from "../../lib/dice-schema"
import "../../styles/dice.scss"

const PLAYER_VAR: Record<string, string> = {
  Josh: "--textJosh",
  Jorge: "--textJorge",
  Mike: "--textMike",
  Noah: "--textNoah",
  Tanner: "--textTanner",
}

type Tab = "overview" | "distribution" | "timeline" | "usage" | "table"
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "distribution", label: "Distributions" },
  { id: "timeline", label: "Over time" },
  { id: "usage", label: "Die usage" },
  { id: "table", label: "All rolls" },
]

// --- palette read from the live theme (re-read on themechange) ---
function readPalette() {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string) => css.getPropertyValue(n).trim()
  const player = (name: string) => v(PLAYER_VAR[name] ?? "--secondary") || v("--secondary")
  return {
    ink: v("--darkgray") || "#dce8f0",
    head: v("--dark") || "#e8f2f8",
    muted: v("--gray") || "#7a8a99",
    grid: v("--lightgray") || "#171c24",
    teal: v("--secondary") || "#6dd5c0",
    amber: v("--tertiary") || "#f0b46e",
    player,
  }
}
type Palette = ReturnType<typeof readPalette>

/** Reusable ECharts host. Rebuilds its option reactively + on theme change. */
function EChart(props: { option: () => echarts.EChartsOption; height?: number }) {
  let el!: HTMLDivElement
  let chart: echarts.ECharts | undefined
  onMount(() => {
    chart = echarts.init(el, null, { renderer: "canvas" })
    chart.setOption(props.option())
    const ro = new ResizeObserver(() => chart?.resize())
    ro.observe(el)
    const onTheme = () => chart?.setOption(props.option(), true)
    document.addEventListener("themechange", onTheme)
    onCleanup(() => {
      ro.disconnect()
      document.removeEventListener("themechange", onTheme)
      chart?.dispose()
    })
  })
  createEffect(() => {
    const opt = props.option()
    chart?.setOption(opt, true)
  })
  return <div class="dice-chart" style={{ height: `${props.height ?? 400}px` }} ref={el} />
}

const fmtNum = (x: number) => x.toLocaleString()
const fmtDate = (iso: string) => (iso ? iso.slice(0, 10) : "—")

export default function DiceDashboard() {
  const [summary, setSummary] = createSignal<DiceSummary | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [tab, setTab] = createSignal<Tab>("overview")
  const [palette, setPalette] = createSignal<Palette>()

  onMount(async () => {
    setPalette(readPalette())
    document.addEventListener("themechange", () => setPalette(readPalette()))
    try {
      const res = await fetch("/dice/summary.json", { cache: "no-cache" })
      if (!res.ok) throw new Error(`no export yet (${res.status})`)
      setSummary((await res.json()) as DiceSummary)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  })

  return (
    <div class="dice-dashboard">
      <header class="dice-head">
        <h1>Dice</h1>
        <Show when={summary()}>
          {(s) => (
            <p class="dice-sub">
              {fmtNum(s().meta.totalRolls)} dice rolled · {s().meta.players.length} players ·{" "}
              {fmtDate(s().meta.dateRange.from)} → {fmtDate(s().meta.dateRange.to)}
            </p>
          )}
        </Show>
        <a class="dice-back" href="/">
          ← back to the wiki
        </a>
      </header>

      <Show when={!loading()} fallback={<p class="dice-note">Loading roll history…</p>}>
        <Show
          when={summary()}
          fallback={
            <p class="dice-note">
              No roll data has been exported yet. Run <code>bun scripts/export-dice.ts</code> on the
              host (the nightly timer does this automatically). {error() ? `(${error()})` : ""}
            </p>
          }
        >
          {(s) => (
            <>
              <nav class="dice-tabs">
                <For each={TABS}>
                  {(t) => (
                    <button
                      type="button"
                      class={`dice-tab${tab() === t.id ? " active" : ""}`}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                    </button>
                  )}
                </For>
              </nav>

              <Show when={tab() === "overview"}>
                <Overview summary={s()} palette={palette()!} />
              </Show>
              <Show when={tab() === "distribution"}>
                <Distribution summary={s()} palette={palette()!} />
              </Show>
              <Show when={tab() === "timeline"}>
                <Timeline summary={s()} palette={palette()!} />
              </Show>
              <Show when={tab() === "usage"}>
                <Usage summary={s()} palette={palette()!} />
              </Show>
              <Show when={tab() === "table"}>
                <RollsTable summary={s()} />
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  )
}

// ---------- Overview ----------
function Overview(props: { summary: DiceSummary; palette: Palette }) {
  const lb = () => props.summary.leaderboards
  const cards: { title: string; entries: { name: string; value: string; detail?: string }[] }[] =
    [
      {
        title: "Luckiest (d20)",
        entries: lb().luckiest.map((e) => ({
          name: e.name,
          value: `+${e.value.toFixed(2)}`,
          detail: e.detail,
        })),
      },
      {
        title: "Unluckiest (d20)",
        entries: lb().unluckiest.map((e) => ({
          name: e.name,
          value: e.value.toFixed(2),
          detail: e.detail,
        })),
      },
      {
        title: "Most crits (nat 20)",
        entries: lb().mostCrits.map((e) => ({
          name: e.name,
          value: fmtNum(e.value),
          detail: e.detail,
        })),
      },
      {
        title: "Most fumbles (nat 1)",
        entries: lb().mostFumbles.map((e) => ({
          name: e.name,
          value: fmtNum(e.value),
          detail: e.detail,
        })),
      },
      {
        title: "Most rolls",
        entries: lb().mostRolls.map((e) => ({ name: e.name, value: fmtNum(e.value) })),
      },
    ]
  return (
    <div class="dice-overview">
      <p class="dice-note dice-note--inline">
        Luck = observed d20 mean − fair mean (10.5). “Dice rolled” counts individual dice, not roll
        commands.
      </p>
      <div class="dice-cards">
        <For each={cards}>
          {(card) => (
            <div class="dice-card">
              <h3>{card.title}</h3>
              <ol>
                <For each={card.entries}>
                  {(e) => (
                    <li>
                      <span class="dot" style={{ background: props.palette.player(e.name) }} />
                      <span class="nm">{e.name}</span>
                      <span class="val">{e.value}</span>
                      <Show when={e.detail}>
                        <span class="det">{e.detail}</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ol>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

// ---------- Distribution (per-face % per player, one base) ----------
function Distribution(props: { summary: DiceSummary; palette: Palette }) {
  const basesWithData = () => {
    const set = new Set<number>()
    for (const p of props.summary.perPlayer)
      for (const k of Object.keys(p.byBase)) {
        const b = Number(k)
        if ((p.byBase[k] as BaseStats).count >= 20 && b > 1) set.add(b)
      }
    return [...set].sort((a, b) => a - b)
  }
  const [base, setBase] = createSignal(basesWithData().includes(20) ? 20 : (basesWithData()[0] ?? 20))

  const option = createMemo<echarts.EChartsOption>(() => {
    const b = base()
    const pal = props.palette
    const faces = Array.from({ length: b }, (_, i) => i + 1)
    const players = props.summary.perPlayer.filter((p) => p.byBase[String(b)]?.count >= 20)
    const series: echarts.LineSeriesOption[] = players.map((p) => {
      const st = p.byBase[String(b)]!
      const n = st.count
      return {
        name: p.name,
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2 },
        itemStyle: { color: pal.player(p.name) },
        data: st.histogram.map((c) => (n ? (100 * c) / n : 0)),
      }
    })
    return {
      backgroundColor: "transparent",
      textStyle: { color: pal.ink, fontFamily: "inherit" },
      tooltip: { trigger: "axis", valueFormatter: (v) => `${(v as number).toFixed(1)}%` },
      legend: { textStyle: { color: pal.ink }, top: 0 },
      grid: { left: 44, right: 16, top: 40, bottom: 36 },
      xAxis: {
        type: "category",
        data: faces.map(String),
        name: `d${b} face`,
        nameLocation: "middle",
        nameGap: 24,
        axisLine: { lineStyle: { color: pal.muted } },
        axisLabel: { color: pal.muted },
      },
      yAxis: {
        type: "value",
        name: "% of rolls",
        axisLabel: { color: pal.muted, formatter: "{value}%" },
        splitLine: { lineStyle: { color: pal.grid } },
      },
      series: [
        ...series,
        {
          name: "fair die",
          type: "line",
          data: faces.map(() => 100 / b),
          lineStyle: { type: "dashed", color: pal.muted, width: 1.5 },
          symbol: "none",
          silent: true,
          tooltip: { show: false },
        },
      ],
    }
  })

  return (
    <div>
      <div class="dice-controls">
        <label>
          Die&nbsp;
          <select onChange={(e) => setBase(Number(e.currentTarget.value))}>
            <For each={basesWithData()}>
              {(b) => (
                <option value={b} selected={b === base()}>
                  d{b}
                </option>
              )}
            </For>
          </select>
        </label>
        <span class="dice-note dice-note--inline">
          % of each player’s d{base()} rolls landing on each face; dashed line = a perfectly fair die.
        </span>
      </div>
      <EChart option={option} height={440} />
    </div>
  )
}

// ---------- Timeline (monthly roll volume per player) ----------
function Timeline(props: { summary: DiceSummary; palette: Palette }) {
  const option = createMemo<echarts.EChartsOption>(() => {
    const pal = props.palette
    const periods = props.summary.timeline.map((t) => t.period)
    const players = props.summary.meta.players
    const series: echarts.LineSeriesOption[] = players.map((name) => ({
      name,
      type: "line",
      stack: "total",
      areaStyle: { opacity: 0.25 },
      smooth: true,
      symbol: "none",
      lineStyle: { width: 1.5 },
      itemStyle: { color: pal.player(name) },
      data: props.summary.timeline.map((t) => t.perPlayer[name] ?? 0),
    }))
    return {
      backgroundColor: "transparent",
      textStyle: { color: pal.ink, fontFamily: "inherit" },
      tooltip: { trigger: "axis" },
      legend: { textStyle: { color: pal.ink }, top: 0 },
      grid: { left: 48, right: 16, top: 40, bottom: 60 },
      dataZoom: [{ type: "slider", bottom: 8, height: 18 }, { type: "inside" }],
      xAxis: {
        type: "category",
        data: periods,
        axisLine: { lineStyle: { color: pal.muted } },
        axisLabel: { color: pal.muted },
      },
      yAxis: {
        type: "value",
        name: "dice rolled",
        axisLabel: { color: pal.muted },
        splitLine: { lineStyle: { color: pal.grid } },
      },
      series,
    }
  })
  return (
    <div>
      <p class="dice-note dice-note--inline">
        Dice rolled per month, stacked by player. Drag the slider to zoom a span.
      </p>
      <EChart option={option} height={440} />
    </div>
  )
}

// ---------- Die usage (stacked bar: bases per player) ----------
function Usage(props: { summary: DiceSummary; palette: Palette }) {
  const option = createMemo<echarts.EChartsOption>(() => {
    const pal = props.palette
    const players = props.summary.perPlayer
    const bases = props.summary.meta.bases
    const series: echarts.BarSeriesOption[] = bases.map((b, i) => ({
      name: `d${b}`,
      type: "bar",
      stack: "total",
      emphasis: { focus: "series" },
      itemStyle: {
        // teal→amber ramp across bases for a coherent gothic feel
        color: mix(pal.teal, pal.amber, bases.length > 1 ? i / (bases.length - 1) : 0),
      },
      data: players.map((p) => p.byBase[String(b)]?.count ?? 0),
    }))
    return {
      backgroundColor: "transparent",
      textStyle: { color: pal.ink, fontFamily: "inherit" },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { textStyle: { color: pal.ink }, top: 0, type: "scroll" },
      grid: { left: 70, right: 16, top: 40, bottom: 24 },
      xAxis: {
        type: "value",
        name: "dice rolled",
        axisLabel: { color: pal.muted },
        splitLine: { lineStyle: { color: pal.grid } },
      },
      yAxis: {
        type: "category",
        data: players.map((p) => p.name),
        axisLine: { lineStyle: { color: pal.muted } },
        axisLabel: { color: pal.ink },
      },
      series,
    }
  })
  return (
    <div>
      <p class="dice-note dice-note--inline">Which dice each player actually rolls, by volume.</p>
      <EChart option={option} height={Math.max(280, props.summary.perPlayer.length * 64)} />
    </div>
  )
}

/** linear blend of two hex/rgb color strings (t in 0..1). */
function mix(a: string, b: string, t: number): string {
  const pa = parseColor(a)
  const pb = parseColor(b)
  if (!pa || !pb) return a
  const c = pa.map((x, i) => Math.round(x + (pb[i]! - x) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
function parseColor(s: string): [number, number, number] | null {
  s = s.trim()
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const [r, g, b] = m[1]!.split(",").map((x) => parseFloat(x))
    return [r!, g!, b!]
  }
  if (s.startsWith("#")) {
    const h = s.slice(1)
    const hex = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
  }
  return null
}

// ---------- All rolls table ----------
function RollsTable(props: { summary: DiceSummary }) {
  const [rolls, setRolls] = createSignal<DiceRoll[] | null>(null)
  const [err, setErr] = createSignal<string | null>(null)
  const [player, setPlayer] = createSignal<string>("all")
  const [page, setPage] = createSignal(0)
  const PAGE = 100

  onMount(async () => {
    try {
      const res = await fetch("/dice/rolls.json", { cache: "no-cache" })
      if (!res.ok) throw new Error(`rolls.json ${res.status}`)
      setRolls((await res.json()) as DiceRoll[])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  })

  const filtered = createMemo(() => {
    const all = rolls() ?? []
    const p = player()
    return p === "all" ? all : all.filter((r) => r.p === p)
  })
  const pageRows = createMemo(() => {
    const f = filtered()
    const start = page() * PAGE
    return f.slice(start, start + PAGE)
  })
  const pages = createMemo(() => Math.max(1, Math.ceil(filtered().length / PAGE)))

  return (
    <div class="dice-tablewrap">
      <div class="dice-controls">
        <label>
          Player&nbsp;
          <select
            onChange={(e) => {
              setPlayer(e.currentTarget.value)
              setPage(0)
            }}
          >
            <option value="all">All</option>
            <For each={props.summary.meta.players}>{(n) => <option value={n}>{n}</option>}</For>
          </select>
        </label>
        <span class="dice-downloads">
          Download:
          <a href="/dice/rolls.csv" download="faerrin-rolls.csv">
            CSV
          </a>
          <a href="/dice/rolls.parquet" download="faerrin-rolls.parquet">
            Parquet
          </a>
        </span>
      </div>

      <Show when={rolls()} fallback={<p class="dice-note">{err() ?? "Loading rolls…"}</p>}>
        <p class="dice-note dice-note--inline">{fmtNum(filtered().length)} rolls</p>
        <table class="dice-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Player</th>
              <th>Die</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <For each={pageRows()}>
              {(r) => (
                <tr>
                  <td>{r.t.replace("T", " ").slice(0, 19)}</td>
                  <td>{r.p}</td>
                  <td>d{r.b}</td>
                  <td>{r.v}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <div class="dice-pager">
          <button type="button" disabled={page() === 0} onClick={() => setPage((p) => p - 1)}>
            ‹ Prev
          </button>
          <span>
            Page {page() + 1} / {pages()}
          </span>
          <button
            type="button"
            disabled={page() >= pages() - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next ›
          </button>
        </div>
      </Show>
    </div>
  )
}
