/**
 * Graph — faithful pixi/d3 port of graph.inline.ts + Graph.tsx (Phase 3; pixi
 * kept per the owner's decision over the debate's lighter-canvas recommendation).
 * Mounted client:only="solid" (pixi calls getComputedStyle/devicePixelRatio at
 * setup — crashes under SSR). Data comes from /static/contentIndex.json (the slim
 * {title,links,tags} index emitted from site.ts), replacing Quartz's fetchData.
 *
 * Rebinding: nav→onMount, getFullSlug→body.dataset.slug, window.spaNavigate→
 * location.assign, window.addCleanup→onCleanup, themechange re-render preserved.
 * registerEscapeHandler / removeAllChildren are ported inline (no Quartz dep).
 * The non-reactive imperative pixi architecture is preserved deliberately.
 */
import { onCleanup, onMount } from "solid-js"
import {
  forceSimulation,
  forceManyBody,
  forceCenter,
  forceLink,
  forceCollide,
  forceRadial,
} from "d3-force"
import { zoom, zoomIdentity } from "d3-zoom"
import { drag } from "d3-drag"
import { select } from "d3-selection"
import { Text, Graphics, Application, Container, Circle } from "pixi.js"
import { Group as TweenGroup, Tween as Tweened } from "@tweenjs/tween.js"
import { resolveRelative, simplifySlug } from "../../lib/slug.ts"

interface D3Config {
  drag: boolean
  zoom: boolean
  depth: number
  scale: number
  repelForce: number
  centerForce: number
  linkDistance: number
  fontSize: number
  opacityScale: number
  removeTags: string[]
  showTags: boolean
  focusOnHover?: boolean
  enableRadial?: boolean
}

// quartz.layout.ts: Graph({ localGraph: { scale: 50.0 } }); rest are Graph.tsx defaults.
const LOCAL_CFG: D3Config = {
  drag: true,
  zoom: true,
  depth: 1,
  scale: 50.0,
  repelForce: 0.5,
  centerForce: 0.3,
  linkDistance: 30,
  fontSize: 0.6,
  opacityScale: 1,
  showTags: true,
  removeTags: [],
  focusOnHover: false,
  enableRadial: false,
}
const GLOBAL_CFG: D3Config = {
  drag: true,
  zoom: true,
  depth: -1,
  scale: 0.9,
  repelForce: 0.5,
  centerForce: 0.2,
  linkDistance: 30,
  fontSize: 0.6,
  opacityScale: 1,
  showTags: true,
  removeTags: [],
  focusOnHover: true,
  enableRadial: true,
}

const VISITED_KEY = "graph-visited"
const getVisited = (): Set<string> => new Set(JSON.parse(localStorage.getItem(VISITED_KEY) ?? "[]"))
const addToVisited = (slug: string) => {
  const v = getVisited()
  v.add(slug)
  localStorage.setItem(VISITED_KEY, JSON.stringify([...v]))
}

const removeAllChildren = (node: HTMLElement) => {
  while (node.firstChild) node.removeChild(node.firstChild)
}
// ported from quartz/components/scripts/util.ts; returns its own teardown.
function registerEscapeHandler(outside: HTMLElement | null, cb: () => void): () => void {
  if (!outside) return () => {}
  const click = function (this: HTMLElement, e: MouseEvent) {
    if (e.target !== this) return
    e.preventDefault()
    e.stopPropagation()
    cb()
  }
  const esc = (e: KeyboardEvent) => {
    if (!e.key.startsWith("Esc")) return
    e.preventDefault()
    cb()
  }
  outside.addEventListener("click", click)
  document.addEventListener("keydown", esc)
  return () => {
    outside.removeEventListener("click", click)
    document.removeEventListener("keydown", esc)
  }
}

type ContentDetails = { title: string; links: string[]; tags: string[] }
let dataCache: Map<string, ContentDetails> | null = null
async function loadData(): Promise<Map<string, ContentDetails>> {
  if (dataCache) return dataCache
  const raw = (await fetch("/static/contentIndex.json").then((r) => r.json())) as Record<
    string,
    ContentDetails
  >
  dataCache = new Map(Object.entries(raw).map(([k, v]) => [simplifySlug(k as any), v]))
  return dataCache
}

async function renderGraph(
  graph: HTMLElement,
  fullSlug: string,
  cfg: D3Config,
  rawData: Map<string, ContentDetails>,
): Promise<() => void> {
  const slug = simplifySlug(fullSlug as any)
  const visited = getVisited()
  removeAllChildren(graph)

  const {
    drag: enableDrag,
    zoom: enableZoom,
    depth,
    scale,
    repelForce,
    centerForce,
    linkDistance,
    fontSize,
    opacityScale,
    removeTags,
    showTags,
    focusOnHover,
    enableRadial,
  } = cfg

  const data = rawData
  const links: { source: string; target: string }[] = []
  const tags: string[] = []
  const validLinks = new Set(data.keys())
  const tweens = new Map<string, { update: (t: number) => void; stop: () => void }>()

  for (const [source, details] of data.entries()) {
    for (const dest of details.links ?? []) {
      if (validLinks.has(dest)) links.push({ source, target: dest })
    }
    if (showTags) {
      const localTags = (details.tags ?? [])
        .filter((tag) => !removeTags.includes(tag))
        .map((tag) => simplifySlug(("tags/" + tag) as any))
      tags.push(...localTags.filter((tag) => !tags.includes(tag)))
      for (const tag of localTags) links.push({ source, target: tag })
    }
  }

  const neighbourhood = new Set<string>()
  const wl: string[] = [slug, "__SENTINEL"]
  let d = depth
  if (d >= 0) {
    while (d >= 0 && wl.length > 0) {
      const cur = wl.shift()!
      if (cur === "__SENTINEL") {
        d--
        wl.push("__SENTINEL")
      } else {
        neighbourhood.add(cur)
        const outgoing = links.filter((l) => l.source === cur)
        const incoming = links.filter((l) => l.target === cur)
        wl.push(...outgoing.map((l) => l.target), ...incoming.map((l) => l.source))
      }
    }
  } else {
    validLinks.forEach((id) => neighbourhood.add(id))
    if (showTags) tags.forEach((tag) => neighbourhood.add(tag))
  }

  const nodes = [...neighbourhood].map((url) => ({
    id: url,
    text: url.startsWith("tags/") ? "#" + url.substring(5) : (data.get(url)?.title ?? url),
    tags: data.get(url)?.tags ?? [],
  }))
  const graphData: { nodes: any[]; links: any[] } = {
    nodes,
    links: links
      .filter((l) => neighbourhood.has(l.source) && neighbourhood.has(l.target))
      .map((l) => ({
        source: nodes.find((n) => n.id === l.source)!,
        target: nodes.find((n) => n.id === l.target)!,
      })),
  }

  const width = graph.offsetWidth
  const height = Math.max(graph.offsetHeight, 250)

  const simulation = forceSimulation(graphData.nodes)
    .force("charge", forceManyBody().strength(-100 * repelForce))
    .force("center", forceCenter().strength(centerForce))
    .force("link", forceLink(graphData.links).distance(linkDistance))
    .force("collide", forceCollide((n: any) => nodeRadius(n)).iterations(3))

  const radius = (Math.min(width, height) / 2) * 0.8
  if (enableRadial) simulation.force("radial", forceRadial(radius).strength(0.2))

  const cssVars = [
    "--secondary",
    "--tertiary",
    "--gray",
    "--light",
    "--lightgray",
    "--dark",
    "--darkgray",
    "--bodyFont",
  ] as const
  const cs = getComputedStyle(document.documentElement)
  const computedStyleMap = cssVars.reduce(
    (acc, key) => {
      acc[key] = cs.getPropertyValue(key)
      return acc
    },
    {} as Record<string, string>,
  )

  const color = (dd: any) => {
    if (dd.id === slug) return computedStyleMap["--secondary"]
    if (visited.has(dd.id) || dd.id.startsWith("tags/")) return computedStyleMap["--tertiary"]
    return computedStyleMap["--gray"]
  }
  function nodeRadius(dd: any) {
    const numLinks = graphData.links.filter(
      (l: any) => l.source.id === dd.id || l.target.id === dd.id,
    ).length
    return 2 + Math.sqrt(numLinks)
  }

  let hoveredNodeId: string | null = null
  let hoveredNeighbours = new Set<string>()
  const linkRenderData: any[] = []
  const nodeRenderData: any[] = []
  function updateHoverInfo(newHoveredId: string | null) {
    hoveredNodeId = newHoveredId
    if (newHoveredId === null) {
      hoveredNeighbours = new Set()
      for (const n of nodeRenderData) n.active = false
      for (const l of linkRenderData) l.active = false
    } else {
      hoveredNeighbours = new Set()
      for (const l of linkRenderData) {
        const ld = l.simulationData
        if (ld.source.id === newHoveredId || ld.target.id === newHoveredId) {
          hoveredNeighbours.add(ld.source.id)
          hoveredNeighbours.add(ld.target.id)
        }
        l.active = ld.source.id === newHoveredId || ld.target.id === newHoveredId
      }
      for (const n of nodeRenderData) n.active = hoveredNeighbours.has(n.simulationData.id)
    }
  }

  let dragStartTime = 0
  let dragging = false

  function renderLinks() {
    tweens.get("link")?.stop()
    const tg = new TweenGroup()
    for (const l of linkRenderData) {
      let alpha = 1
      if (hoveredNodeId) alpha = l.active ? 1 : 0.2
      l.color = l.active ? computedStyleMap["--gray"] : computedStyleMap["--lightgray"]
      tg.add(new Tweened(l).to({ alpha }, 200))
    }
    tg.getAll().forEach((tw) => tw.start())
    tweens.set("link", {
      update: tg.update.bind(tg),
      stop: () => tg.getAll().forEach((tw) => tw.stop()),
    })
  }
  function renderLabels() {
    tweens.get("label")?.stop()
    const tg = new TweenGroup()
    const defaultScale = 1 / scale
    const activeScale = defaultScale * 1.1
    for (const n of nodeRenderData) {
      if (hoveredNodeId === n.simulationData.id) {
        tg.add(
          new Tweened(n.label).to({ alpha: 1, scale: { x: activeScale, y: activeScale } }, 100),
        )
      } else {
        tg.add(
          new Tweened(n.label).to(
            { alpha: n.label.alpha, scale: { x: defaultScale, y: defaultScale } },
            100,
          ),
        )
      }
    }
    tg.getAll().forEach((tw) => tw.start())
    tweens.set("label", {
      update: tg.update.bind(tg),
      stop: () => tg.getAll().forEach((tw) => tw.stop()),
    })
  }
  function renderNodes() {
    tweens.get("hover")?.stop()
    const tg = new TweenGroup()
    for (const n of nodeRenderData) {
      let alpha = 1
      if (hoveredNodeId !== null && focusOnHover) alpha = n.active ? 1 : 0.2
      tg.add(new Tweened(n.gfx, tg).to({ alpha }, 200))
    }
    tg.getAll().forEach((tw) => tw.start())
    tweens.set("hover", {
      update: tg.update.bind(tg),
      stop: () => tg.getAll().forEach((tw) => tw.stop()),
    })
  }
  function renderPixiFromD3() {
    renderNodes()
    renderLinks()
    renderLabels()
  }

  tweens.forEach((t) => t.stop())
  tweens.clear()

  const app = new Application()
  await app.init({
    width,
    height,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    backgroundAlpha: 0,
    preference: "webgpu",
    resolution: window.devicePixelRatio,
    eventMode: "static",
  })
  graph.appendChild(app.canvas)

  const stage = app.stage
  stage.interactive = false
  const labelsContainer = new Container({ zIndex: 3, isRenderGroup: true })
  const nodesContainer = new Container({ zIndex: 2, isRenderGroup: true })
  const linkContainer = new Container({ zIndex: 1, isRenderGroup: true })
  stage.addChild(nodesContainer, labelsContainer, linkContainer)

  for (const n of graphData.nodes) {
    const nodeId = n.id
    const label = new Text({
      interactive: false,
      eventMode: "none",
      text: n.text,
      alpha: 0,
      anchor: { x: 0.5, y: 1.2 },
      style: {
        fontSize: fontSize * 15,
        fill: computedStyleMap["--dark"],
        fontFamily: computedStyleMap["--bodyFont"],
      },
      resolution: window.devicePixelRatio * 4,
    })
    label.scale.set(1 / scale)
    let oldLabelOpacity = 0
    const isTagNode = nodeId.startsWith("tags/")
    const gfx = new Graphics({
      interactive: true,
      label: nodeId,
      eventMode: "static",
      hitArea: new Circle(0, 0, nodeRadius(n)),
      cursor: "pointer",
    })
      .circle(0, 0, nodeRadius(n))
      .fill({ color: isTagNode ? computedStyleMap["--light"] : color(n) })
      .on("pointerover", (e: any) => {
        updateHoverInfo(e.target.label)
        oldLabelOpacity = label.alpha
        if (!dragging) renderPixiFromD3()
      })
      .on("pointerleave", () => {
        updateHoverInfo(null)
        label.alpha = oldLabelOpacity
        if (!dragging) renderPixiFromD3()
      })
    if (isTagNode) gfx.stroke({ width: 2, color: computedStyleMap["--tertiary"] })
    nodesContainer.addChild(gfx)
    labelsContainer.addChild(label)
    nodeRenderData.push({ simulationData: n, gfx, label, color: color(n), alpha: 1, active: false })
  }

  for (const l of graphData.links) {
    const gfx = new Graphics({ interactive: false, eventMode: "none" })
    linkContainer.addChild(gfx)
    linkRenderData.push({
      simulationData: l,
      gfx,
      color: computedStyleMap["--lightgray"],
      alpha: 1,
      active: false,
    })
  }

  let currentTransform = zoomIdentity
  if (enableDrag) {
    select(app.canvas as any).call(
      drag()
        .container(() => app.canvas as any)
        .subject(() => graphData.nodes.find((n) => n.id === hoveredNodeId))
        .on("start", (event: any) => {
          if (!event.active) simulation.alphaTarget(1).restart()
          event.subject.fx = event.subject.x
          event.subject.fy = event.subject.y
          event.subject.__initialDragPos = {
            x: event.subject.x,
            y: event.subject.y,
            fx: event.subject.fx,
            fy: event.subject.fy,
          }
          dragStartTime = Date.now()
          dragging = true
        })
        .on("drag", (event: any) => {
          const initPos = event.subject.__initialDragPos
          event.subject.fx = initPos.x + (event.x - initPos.x) / currentTransform.k
          event.subject.fy = initPos.y + (event.y - initPos.y) / currentTransform.k
        })
        .on("end", (event: any) => {
          if (!event.active) simulation.alphaTarget(0)
          event.subject.fx = null
          event.subject.fy = null
          dragging = false
          if (Date.now() - dragStartTime < 500) {
            const node = graphData.nodes.find((n) => n.id === event.subject.id)
            window.location.assign(resolveRelative(fullSlug as any, node.id))
          }
        }) as any,
    )
  } else {
    for (const node of nodeRenderData) {
      node.gfx.on("click", () =>
        window.location.assign(resolveRelative(fullSlug as any, node.simulationData.id)),
      )
    }
  }

  if (enableZoom) {
    select(app.canvas as any).call(
      zoom()
        .extent([
          [0, 0],
          [width, height],
        ])
        .scaleExtent([0.25, 4])
        .on("zoom", ({ transform }: any) => {
          currentTransform = transform
          stage.scale.set(transform.k, transform.k)
          stage.position.set(transform.x, transform.y)
          const zscale = transform.k * opacityScale
          const scaleOpacity = Math.max((zscale - 1) / 3.75, 0)
          const activeNodes = nodeRenderData.filter((n) => n.active).flatMap((n) => n.label)
          for (const label of labelsContainer.children) {
            if (!activeNodes.includes(label)) (label as any).alpha = scaleOpacity
          }
        }) as any,
    )
  }

  let stopAnimation = false
  function animate(time: number) {
    if (stopAnimation) return
    for (const n of nodeRenderData) {
      const { x, y } = n.simulationData
      if (!x || !y) continue
      n.gfx.position.set(x + width / 2, y + height / 2)
      if (n.label) n.label.position.set(x + width / 2, y + height / 2)
    }
    for (const l of linkRenderData) {
      const ld = l.simulationData
      l.gfx.clear()
      l.gfx.moveTo(ld.source.x + width / 2, ld.source.y + height / 2)
      l.gfx
        .lineTo(ld.target.x + width / 2, ld.target.y + height / 2)
        .stroke({ alpha: l.alpha, width: 1, color: l.color })
    }
    tweens.forEach((t) => t.update(time))
    app.renderer.render(stage)
    requestAnimationFrame(animate)
  }
  requestAnimationFrame(animate)

  return () => {
    stopAnimation = true
    app.destroy()
  }
}

export default function Graph() {
  let localContainer: HTMLDivElement | undefined
  let globalOuter: HTMLDivElement | undefined
  let globalContainer: HTMLDivElement | undefined
  let globalIcon: HTMLButtonElement | undefined

  onMount(() => {
    const slug = document.body.dataset.slug ?? ""
    addToVisited(simplifySlug(slug as any))

    // Async-abort guard: renderGraph awaits loadData() + pixi app.init(); if the
    // island is torn down mid-await, a resolved graph would append a canvas and
    // start an unbounded rAF loop on an app nothing destroys. Bail + destroy.
    let disposed = false
    let localCleanup: (() => void) | null = null
    const globalCleanups: (() => void)[] = []
    let escCleanup: (() => void) | null = null

    const renderLocal = async () => {
      localCleanup?.()
      localCleanup = null
      const data = await loadData()
      if (disposed) return
      const cleanup = await renderGraph(localContainer!, slug, LOCAL_CFG, data)
      if (disposed) {
        cleanup()
        return
      }
      localCleanup = cleanup
    }
    void renderLocal()

    const onThemeChange = () => void renderLocal()
    document.addEventListener("themechange", onThemeChange)

    const hideGlobal = () => {
      for (const c of globalCleanups.splice(0)) c()
      escCleanup?.()
      escCleanup = null
      globalOuter?.classList.remove("active")
    }
    const showGlobal = async () => {
      globalOuter?.classList.add("active")
      escCleanup = registerEscapeHandler(globalOuter ?? null, hideGlobal)
      const data = await loadData()
      if (disposed) return
      const cleanup = await renderGraph(globalContainer!, slug, GLOBAL_CFG, data)
      if (disposed || !globalOuter?.classList.contains("active")) {
        cleanup()
        return
      }
      globalCleanups.push(cleanup)
    }

    const onShortcut = (e: KeyboardEvent) => {
      if (e.key === "g" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        globalOuter?.classList.contains("active") ? hideGlobal() : void showGlobal()
      }
    }
    document.addEventListener("keydown", onShortcut)

    const onIconClick = () => void showGlobal()
    globalIcon?.addEventListener("click", onIconClick)

    onCleanup(() => {
      disposed = true
      document.removeEventListener("themechange", onThemeChange)
      document.removeEventListener("keydown", onShortcut)
      globalIcon?.removeEventListener("click", onIconClick)
      localCleanup?.()
      for (const c of globalCleanups.splice(0)) c()
      escCleanup?.()
    })
  })

  return (
    <div class="graph">
      <h3>Graph View</h3>
      <div class="graph-outer">
        <div ref={localContainer} class="graph-container" />
        <button ref={globalIcon} class="global-graph-icon" aria-label="Global Graph" type="button">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 55 55" fill="currentColor">
            <path d="M49,0c-3.309,0-6,2.691-6,6c0,1.035,0.263,2.009,0.726,2.86l-9.829,9.829C32.542,17.634,30.846,17,29,17 s-3.542,0.634-4.898,1.688l-7.669-7.669C16.785,10.424,17,9.74,17,9c0-2.206-1.794-4-4-4S9,6.794,9,9s1.794,4,4,4 c0.74,0,1.424-0.215,2.019-0.567l7.669,7.669C21.634,21.458,21,23.154,21,25s0.634,3.542,1.688,4.897L10.024,42.562 C8.958,41.595,7.549,41,6,41c-3.309,0-6,2.691-6,6s2.691,6,6,6s6-2.691,6-6c0-1.035-0.263-2.009-0.726-2.86l12.829-12.829 c1.106,0.86,2.44,1.436,3.898,1.619v10.16c-2.833,0.478-5,2.942-5,5.91c0,3.309,2.691,6,6,6s6-2.691,6-6c0-2.967-2.167-5.431-5-5.91 v-10.16c1.458-0.183,2.792-0.759,3.898-1.619l7.669,7.669C41.215,39.576,41,40.26,41,41c0,2.206,1.794,4,4,4s4-1.794,4-4 s-1.794-4-4-4c-0.74,0-1.424,0.215-2.019,0.567l-7.669-7.669C36.366,28.542,37,26.846,37,25s-0.634-3.542-1.688-4.897l9.665-9.665 C46.042,11.405,47.451,12,49,12c3.309,0,6-2.691,6-6S52.309,0,49,0z M11,9c0-1.103,0.897-2,2-2s2,0.897,2,2s-0.897,2-2,2 S11,10.103,11,9z M6,51c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S8.206,51,6,51z M33,49c0,2.206-1.794,4-4,4s-4-1.794-4-4 s1.794-4,4-4S33,46.794,33,49z M29,31c-3.309,0-6-2.691-6-6s2.691-6,6-6s6,2.691,6,6S32.309,31,29,31z M47,41c0,1.103-0.897,2-2,2 s-2-0.897-2-2s0.897-2,2-2S47,39.897,47,41z M49,10c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S51.206,10,49,10z" />
          </svg>
        </button>
      </div>
      <div ref={globalOuter} class="global-graph-outer">
        <div ref={globalContainer} class="global-graph-container" />
      </div>
    </div>
  )
}
