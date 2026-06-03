import { useEffect, useRef } from "react";
import {
  Assets,
  Color,
  Container,
  Graphics,
  Polygon,
  Sprite,
  Texture,
  type Application,
  type FederatedPointerEvent,
} from "pixi.js";
import { GlowFilter } from "pixi-filters";
import { usePixi } from "@/components/PixiHost/pixiContext";
import type { Faction } from "@/lib/factions";
import type {
  LayerAnimation,
  Region,
  SkeinRegion,
  SkeinState,
} from "@/lib/layers";
import type { OverlayId } from "@/lib/overlays";
import {
  computeRegionBorders,
  hexPixel,
  type EdgeSegment,
} from "@/lib/hexUtils";
import {
  drawEdgesPath,
  hexVertsAtPixel,
  prefersReducedMotion,
  WORLD_VIEWBOX,
} from "./pixiScene";
import {
  axialDistance,
  easeOutCubic,
  orderEdgesIntoPath,
  partialEdgePath,
  totalEdgeLength,
} from "./animations";
import {
  computeSkeinCurve,
  partialCurvePolyline,
  samplePoint,
  skeinSignature,
  type SkeinCurve,
  type SkeinSignature,
} from "./skeinGeometry";
import { AnimationManager } from "./animationManager";
import styles from "./HexMap.module.css";

interface HexMapProps {
  factions: Faction[];
  regions: Region[];
  skein: SkeinState;
  factionHexes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  unownedHexes: ReadonlyArray<readonly [number, number]>;
  factionBorders: ReadonlyArray<EdgeSegment>;
  territoryBorders: ReadonlyArray<ReadonlyArray<EdgeSegment>>;
  hoveredFaction: number | null;
  hoveredRegionSlug: string | null;
  visibleOverlays: Set<OverlayId>;
  animation?: LayerAnimation | null;
  onFactionClick: (faction: Faction) => void;
  onFactionHover: (factionIdx: number | null) => void;
  onRegionHover: (slug: string | null, factionIdx: number | null) => void;
  onSkeinHover: (slug: string | null, factionIdx: number | null) => void;
}

interface SceneHandle {
  setRegions: (regions: Region[]) => void;
  setRegionsVisible: (v: boolean) => void;
  setHoveredRegion: (slug: string | null) => void;
  setSkein: (skein: SkeinState) => void;
  setSkeinVisible: (v: boolean) => void;
  setHoveredFaction: (idx: number | null) => void;
  setFactionState: (
    factionHexes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
    unownedHexes: ReadonlyArray<readonly [number, number]>,
    factionBorders: ReadonlyArray<EdgeSegment>,
  ) => void;
  startAnimation: (anim: LayerAnimation) => void;
  destroy: () => void;
}

const REVEAL_DELAY_MS = 300;
const REVEAL_DURATION_MS = 400;
const PULSE_PERIOD_MS = 10000;

// cubic-bezier(0.22, 1, 0.36, 1) — matches --ease-out
function easeOutExpoApprox(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export default function HexMap(props: HexMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const pixi = usePixi();

  useEffect(() => {
    if (!pixi) return;
    const host = hostRef.current;
    if (!host) return;

    const { app, panel, world } = pixi;
    const scene = buildScene(world, app, propsRef);
    sceneRef.current = scene;

    // Translucent panel-bg drawn inside Pixi (above the shader, below the
    // map). Keeps the panel chrome looking opaque while the map renders on
    // top, undimmed.
    const panelBg = new Graphics();
    panelBg.label = "panelBg";
    panel.addChild(panelBg);

    const cur = propsRef.current;
    scene.setRegions(cur.regions);
    scene.setRegionsVisible(cur.visibleOverlays.has("regions"));
    scene.setHoveredRegion(cur.hoveredRegionSlug);
    scene.setSkein(cur.skein);
    scene.setSkeinVisible(cur.visibleOverlays.has("skein"));
    scene.setHoveredFaction(cur.hoveredFaction);

    // Position the world container to align with the host element on screen
    // and rescale so the WORLD_VIEWBOX fits inside it. With autoDensity:true,
    // Pixi's stage coords are in CSS pixels, so we use getBoundingClientRect
    // directly (no DPR multiplication needed). The panel-bg rect is sized
    // to the host's parent (.frame) so it includes the panel padding/border.
    const fitToHost = () => {
      const rect = host.getBoundingClientRect();
      const scale = Math.min(
        rect.width / WORLD_VIEWBOX.width,
        rect.height / WORLD_VIEWBOX.height,
      );
      world.scale.set(scale);
      world.position.set(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );

      const frame = host.parentElement;
      if (frame) {
        const fr = frame.getBoundingClientRect();
        panelBg
          .clear()
          .rect(fr.left, fr.top, fr.width, fr.height)
          .fill({ color: 0x0f1318, alpha: 0.85 });
      }
    };
    fitToHost();

    const resizeObs = new ResizeObserver(fitToHost);
    resizeObs.observe(host);
    window.addEventListener("scroll", fitToHost, { passive: true });
    window.addEventListener("resize", fitToHost);

    host.dataset.mapReady = "true";

    return () => {
      resizeObs.disconnect();
      window.removeEventListener("scroll", fitToHost);
      window.removeEventListener("resize", fitToHost);
      sceneRef.current?.destroy();
      sceneRef.current = null;
      panel.removeChild(panelBg);
      panelBg.destroy();
      // Reset world so the next mount starts fresh.
      world.position.set(0, 0);
      world.scale.set(1);
      delete host.dataset.mapReady;
    };
  }, [pixi]);

  useEffect(() => {
    sceneRef.current?.setRegions(props.regions);
  }, [props.regions]);

  useEffect(() => {
    sceneRef.current?.setRegionsVisible(props.visibleOverlays.has("regions"));
    sceneRef.current?.setSkeinVisible(props.visibleOverlays.has("skein"));
  }, [props.visibleOverlays]);

  useEffect(() => {
    sceneRef.current?.setHoveredRegion(props.hoveredRegionSlug);
  }, [props.hoveredRegionSlug]);

  useEffect(() => {
    sceneRef.current?.setSkein(props.skein);
  }, [props.skein]);

  useEffect(() => {
    sceneRef.current?.setHoveredFaction(props.hoveredFaction);
  }, [props.hoveredFaction]);

  useEffect(() => {
    sceneRef.current?.setFactionState(
      props.factionHexes,
      props.unownedHexes,
      props.factionBorders,
    );
  }, [props.factionHexes, props.unownedHexes, props.factionBorders]);

  // Fire animations after the snapshot props above have applied. React runs
  // effects in declaration order, so by the time this runs setRegions/setSkein/
  // setFactionState have already rebuilt the scene to the new state.
  useEffect(() => {
    if (!props.animation) return;
    if (prefersReducedMotion()) return;
    sceneRef.current?.startAnimation(props.animation);
  }, [props.animation]);

  return (
    <div ref={hostRef} className={styles.root} data-testid="hex-map">
      <ul aria-hidden="true" className={styles.testHooks}>
        {props.factions.map((f) => (
          <li key={f.slug}>
            <button
              type="button"
              data-testid="faction-hex"
              data-faction-slug={f.slug}
              onClick={() => props.onFactionClick(f)}
            >
              {f.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildScene(
  world: Container,
  app: Application,
  propsRef: React.RefObject<HexMapProps>,
): SceneHandle {
  const factionHexLayer = new Container();
  factionHexLayer.label = "factionHexes";
  world.addChild(factionHexLayer);

  const unownedHexLayer = new Container();
  unownedHexLayer.label = "unownedHexes";
  unownedHexLayer.eventMode = "passive";
  world.addChild(unownedHexLayer);

  const factionBorderLayer = new Graphics();
  factionBorderLayer.label = "factionBorders";
  world.addChild(factionBorderLayer);

  const regionFillLayer = new Container();
  regionFillLayer.label = "regionFills";
  world.addChild(regionFillLayer);

  const regionBorderLayer = new Container();
  regionBorderLayer.label = "regionBorders";
  world.addChild(regionBorderLayer);

  const hoverGlowLayer = new Graphics();
  hoverGlowLayer.label = "hoverGlow";
  hoverGlowLayer.visible = false;
  world.addChild(hoverGlowLayer);

  // Overlay layer for one-shot replay animations. Lives above the static
  // map layers so draw-on borders / flip overlays sit on top of the snapshot
  // state, but below skein symbol sprites so faction icons aren't occluded.
  const animLayer = new Container();
  animLayer.label = "anim";
  animLayer.eventMode = "passive";
  world.addChild(animLayer);

  const skeinLayer = new Container();
  skeinLayer.label = "skein";
  skeinLayer.eventMode = "passive";
  world.addChild(skeinLayer);

  const animMgr = new AnimationManager();
  // Indexed by "q,r" so flip animations can address the underlying snapshot
  // hex directly. Rebuilt every setFactionState — animations always look up
  // graphics from the *current* snapshot, so the map never goes stale.
  const factionHexByCoord = new Map<string, Graphics>();

  // --- Faction / unowned / border layers — rebuilt whenever the effective
  // assignment changes (e.g. timeline scrubs, claim ops fold in). ---
  // Hexes draw with vertices in local space (centered on 0,0) so that scale.y
  // transforms — used by the flip-wave animation — pivot around the hex's
  // own center rather than the world origin.
  const LOCAL_HEX_VERTS = hexVertsAtPixel(0, 0);
  const LOCAL_HEX_HITAREA = new Polygon(LOCAL_HEX_VERTS);

  function setFactionState(
    factionHexes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
    unownedHexes: ReadonlyArray<readonly [number, number]>,
    factionBorders: ReadonlyArray<EdgeSegment>,
  ) {
    factionHexLayer
      .removeChildren()
      .forEach((c) => c.destroy({ children: true }));
    unownedHexLayer
      .removeChildren()
      .forEach((c) => c.destroy({ children: true }));
    factionHexByCoord.clear();

    factionHexes.forEach((hexes, factionIdx) => {
      const faction = propsRef.current.factions[factionIdx];
      if (!faction) return;
      const color = faction.color;
      for (const [q, r] of hexes) {
        const [cx, cy] = hexPixel(q, r);
        const g = new Graphics();
        g.poly(LOCAL_HEX_VERTS);
        g.fill({ color });
        g.stroke({ color: "#090c10", width: 0.2 });
        g.position.set(cx, cy);
        g.eventMode = "static";
        g.cursor = "pointer";
        g.hitArea = LOCAL_HEX_HITAREA;
        const fIdx = factionIdx;
        g.on("pointerdown", () => {
          propsRef.current.onFactionClick(propsRef.current.factions[fIdx]);
        });
        g.on("pointerover", () => {
          propsRef.current.onFactionHover(fIdx);
        });
        g.on("pointerout", () => {
          propsRef.current.onFactionHover(null);
        });
        factionHexLayer.addChild(g);
        factionHexByCoord.set(`${q},${r}`, g);
      }
    });

    for (const [q, r] of unownedHexes) {
      const [cx, cy] = hexPixel(q, r);
      const g = new Graphics();
      g.poly(LOCAL_HEX_VERTS);
      g.fill({ color: "#787c80" });
      g.stroke({ color: "#090c10", width: 0.2 });
      g.position.set(cx, cy);
      unownedHexLayer.addChild(g);
      factionHexByCoord.set(`${q},${r}`, g);
    }

    factionBorderLayer.clear();
    drawEdgesPath(factionBorderLayer, factionBorders);
    factionBorderLayer.stroke({ color: "#090c10", width: 0.5, cap: "round" });
  }

  setFactionState(
    propsRef.current.factionHexes,
    propsRef.current.unownedHexes,
    propsRef.current.factionBorders,
  );

  // --- Hex reveal animation ---
  const reduced = prefersReducedMotion();
  let revealAlpha = reduced ? 1 : 0;
  factionHexLayer.alpha = revealAlpha;
  unownedHexLayer.alpha = revealAlpha;
  factionBorderLayer.alpha = revealAlpha;
  const mountTime = performance.now();

  const tickerCb = () => {
    const now = performance.now();
    if (revealAlpha < 1) {
      const elapsed = now - mountTime - REVEAL_DELAY_MS;
      if (elapsed >= 0) {
        const t = Math.min(1, elapsed / REVEAL_DURATION_MS);
        revealAlpha = easeOutExpoApprox(t);
        factionHexLayer.alpha = revealAlpha;
        unownedHexLayer.alpha = revealAlpha;
        factionBorderLayer.alpha = revealAlpha;
      }
    }
    advancePulse();
    animMgr.tick(now);
  };
  app.ticker.add(tickerCb);

  // --- Regions state ---
  const regionEntries = new Map<
    string,
    {
      slug: string;
      faction: string | null;
      factionIdx: number | null;
      fill: Graphics;
      border: Graphics;
    }
  >();
  let currentRegions: Region[] = [];
  let hoveredRegionSlug: string | null = null;

  function setRegions(regions: Region[]) {
    currentRegions = regions;
    const seen = new Set<string>();
    const factionIdxBySlug = new Map<string, number>();
    propsRef.current.factions.forEach((f, i) =>
      factionIdxBySlug.set(f.slug, i),
    );

    for (const region of regions) {
      seen.add(region.slug);
      let entry = regionEntries.get(region.slug);
      const factionIdx = factionIdxBySlug.get(region.faction) ?? null;
      const factionSlug = region.faction;

      if (!entry) {
        const fill = new Graphics();
        fill.eventMode = "static";
        fill.cursor = "pointer";
        const border = new Graphics();
        border.filters = [
          new GlowFilter({
            distance: 4,
            outerStrength: 0.8,
            innerStrength: 0,
            color: 0xf0b46e,
            quality: 0.1,
          }),
        ];
        regionFillLayer.addChild(fill);
        regionBorderLayer.addChild(border);
        entry = {
          slug: region.slug,
          faction: factionSlug,
          factionIdx,
          fill,
          border,
        };
        regionEntries.set(region.slug, entry);

        const slug = region.slug;
        fill.on("pointerdown", () => {
          const idx = entry!.factionIdx;
          if (idx !== null) {
            propsRef.current.onFactionClick(propsRef.current.factions[idx]);
          }
        });
        fill.on("pointerover", () => {
          propsRef.current.onRegionHover(slug, entry!.factionIdx);
        });
        fill.on("pointerout", () => {
          propsRef.current.onRegionHover(null, null);
        });
      } else {
        entry.faction = factionSlug;
        entry.factionIdx = factionIdx;
      }

      entry.fill.clear();
      for (const [q, r] of region.hexes) {
        const [cx, cy] = hexPixel(q, r);
        const verts = hexVertsAtPixel(cx, cy);
        entry.fill.poly(verts);
        entry.fill.fill({
          color: "#0a0d12",
          alpha: hoveredRegionSlug === region.slug ? 0.55 : 0.4,
        });
      }

      // Rebuild border
      entry.border.clear();
      const edges = computeRegionBorders(region.hexes);
      const hovered = hoveredRegionSlug === region.slug;
      drawEdgesPath(entry.border, edges);
      entry.border.stroke({
        color: hovered ? "#6dd5c0" : "#f0b46e",
        width: hovered ? 0.35 : 0.22,
        alpha: hovered ? 0.9 : 0.55,
        cap: "round",
      });
      const glow = entry.border.filters?.[0] as GlowFilter | undefined;
      if (glow) {
        glow.color = hovered ? 0x6dd5c0 : 0xf0b46e;
        glow.outerStrength = hovered ? 1.4 : 0.8;
      }
    }

    for (const [slug, entry] of regionEntries) {
      if (!seen.has(slug)) {
        entry.fill.destroy();
        entry.border.destroy();
        regionEntries.delete(slug);
      }
    }
  }

  function setRegionsVisible(v: boolean) {
    regionFillLayer.visible = v;
    regionBorderLayer.visible = v;
  }

  function setHoveredRegion(slug: string | null) {
    if (slug === hoveredRegionSlug) return;
    const prev = hoveredRegionSlug;
    hoveredRegionSlug = slug;
    // Update fill alphas and border strokes for affected regions
    for (const targetSlug of [prev, slug]) {
      if (!targetSlug) continue;
      const entry = regionEntries.get(targetSlug);
      if (!entry) continue;
      const region = currentRegions.find((r) => r.slug === targetSlug);
      if (!region) continue;
      const hovered = targetSlug === hoveredRegionSlug;

      entry.fill.clear();
      for (const [q, r] of region.hexes) {
        const [cx, cy] = hexPixel(q, r);
        const verts = hexVertsAtPixel(cx, cy);
        entry.fill.poly(verts);
        entry.fill.fill({ color: "#0a0d12", alpha: hovered ? 0.55 : 0.4 });
      }

      entry.border.clear();
      const edges = computeRegionBorders(region.hexes);
      drawEdgesPath(entry.border, edges);
      entry.border.stroke({
        color: hovered ? "#6dd5c0" : "#f0b46e",
        width: hovered ? 0.35 : 0.22,
        alpha: hovered ? 0.9 : 0.55,
        cap: "round",
      });
      const glow = entry.border.filters?.[0] as GlowFilter | undefined;
      if (glow) {
        glow.color = hovered ? 0x6dd5c0 : 0xf0b46e;
        glow.outerStrength = hovered ? 1.4 : 0.8;
      }
    }
  }

  // --- Hovered faction (territory glow) ---
  function setHoveredFaction(idx: number | null) {
    hoverGlowLayer.clear();
    if (idx === null) {
      hoverGlowLayer.visible = false;
      hoverGlowLayer.filters = [];
      return;
    }
    const faction = propsRef.current.factions[idx];
    const colorNum = new Color(faction.color).toNumber();
    const territoryEdges = propsRef.current.territoryBorders[idx] ?? [];
    drawEdgesPath(hoverGlowLayer, territoryEdges);
    hoverGlowLayer.stroke({
      color: faction.color,
      width: 0.5,
      cap: "round",
    });
    hoverGlowLayer.filters = [
      new GlowFilter({
        distance: 6,
        outerStrength: 2,
        innerStrength: 0,
        color: colorNum,
        quality: 0.15,
      }),
    ];
    hoverGlowLayer.visible = true;
  }

  // --- Skein ---
  // Lines are rendered per-connection so a single new link can be animated
  // independently (clearing & redrawing just that connection's three Graphics
  // each frame, while siblings stay static).
  const lineLayer = new Container();
  lineLayer.label = "skeinLines";
  const pulseLayer = new Container();
  pulseLayer.label = "skeinPulses";
  const symbolLayer = new Container();
  symbolLayer.label = "skeinSymbols";

  skeinLayer.addChild(lineLayer);
  skeinLayer.addChild(pulseLayer);
  skeinLayer.addChild(symbolLayer);

  interface ConnectionGraphics {
    halo: Graphics;
    glow: Graphics;
    base: Graphics;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    sig: SkeinSignature;
    curve: SkeinCurve;
  }
  // Keyed by canonical "from|to" (sorted so the key matches the connection
  // identifier regardless of direction).
  const connectionGraphics = new Map<string, ConnectionGraphics>();

  function connKey(from: string, to: string): string {
    return from < to ? `${from}|${to}` : `${to}|${from}`;
  }

  function strokeCurveInto(g: Graphics, curve: SkeinCurve, tEnd: number): void {
    const pts = partialCurvePolyline(curve, tEnd);
    if (pts.length < 2) return;
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  }

  function strokeConnection(cg: ConnectionGraphics, tEnd: number): void {
    cg.halo.clear();
    cg.glow.clear();
    cg.base.clear();
    strokeCurveInto(cg.halo, cg.curve, tEnd);
    strokeCurveInto(cg.glow, cg.curve, tEnd);
    strokeCurveInto(cg.base, cg.curve, tEnd);
    cg.halo.stroke({ color: "#06080b", width: 2.0, cap: "round" });
    cg.glow.stroke({
      color: "#fff0d0",
      width: 0.3,
      alpha: 0.25,
      cap: "round",
    });
    cg.base.stroke({
      color: "#f0b46e",
      width: 0.5,
      alpha: 0.6,
      cap: "round",
    });
  }

  interface PulseEntry {
    container: Container;
    beads: Container[];
    curve: SkeinCurve;
    sig: SkeinSignature;
  }
  // Keyed by connection key — pulses can be paused/destroyed per-connection
  // (e.g. while a link's draw-on animation runs the bead loop holds off).
  const pulseEntries = new Map<string, PulseEntry>();

  // Build the "comet" shape once per bead in local coords. Local +x is forward
  // along the bead's instantaneous tangent; per-frame we only set position +
  // rotation. Head sits at the origin; the fading tail trails in −x.
  function drawCometInto(g: Graphics, tailWorldLen: number): void {
    const seg = tailWorldLen / 4;
    const dashes: Array<{ x0: number; x1: number; w: number; a: number }> = [
      { x0: 0, x1: -seg * 0.6, w: 0.6, a: 1.0 },
      { x0: -seg, x1: -seg * 1.7, w: 0.5, a: 0.6 },
      { x0: -seg * 2, x1: -seg * 2.7, w: 0.4, a: 0.35 },
      { x0: -seg * 3, x1: -seg * 3.8, w: 0.3, a: 0.15 },
    ];
    for (const d of dashes) {
      g.moveTo(d.x0, 0);
      g.lineTo(d.x1, 0);
      g.stroke({ color: "#fff0d0", width: d.w, alpha: d.a, cap: "round" });
    }
  }

  function positionBeads(e: PulseEntry, tBase: number): void {
    for (let i = 0; i < e.beads.length; i++) {
      const t = (((tBase + i * e.sig.beadSpacing) % 1) + 1) % 1;
      const p = samplePoint(e.curve, t);
      const bead = e.beads[i];
      bead.position.set(p.x, p.y);
      bead.rotation = Math.atan2(p.ty, p.tx);
    }
  }

  function advancePulse() {
    if (reduced || pulseEntries.size === 0) return;
    const now = performance.now();
    for (const e of pulseEntries.values()) {
      if (!e.container.visible) continue;
      const period = PULSE_PERIOD_MS * e.sig.speedMul;
      const tBase = (now / period) % 1;
      positionBeads(e, tBase + e.sig.phaseOffset);
    }
  }

  function buildPulseEntry(
    curve: SkeinCurve,
    sig: SkeinSignature,
  ): PulseEntry | null {
    if (curve.arcLength === 0) return null;
    const tailWorldLen = sig.tailLen * curve.arcLength;
    const container = new Container();
    const beads: Container[] = [];
    for (let i = 0; i < sig.beadCount; i++) {
      const bead = new Container();
      const g = new Graphics();
      drawCometInto(g, tailWorldLen);
      bead.addChild(g);
      container.addChild(bead);
      beads.push(bead);
    }
    return { container, beads, curve, sig };
  }

  const symbolSprites = new Map<string, Sprite>();
  const symbolTextureCache = new Map<string, Texture>();

  async function setSkein(skein: SkeinState) {
    const factionIdxBySlug = new Map<string, number>();
    propsRef.current.factions.forEach((f, i) =>
      factionIdxBySlug.set(f.slug, i),
    );
    const skeinBySlug = new Map<string, SkeinRegion>();
    for (const r of skein.regions) skeinBySlug.set(r.slug, r);

    const desired = new Map<
      string,
      { x1: number; y1: number; x2: number; y2: number }
    >();
    for (const { from, to } of skein.connections) {
      const a = skeinBySlug.get(from);
      const b = skeinBySlug.get(to);
      if (!a || !b) continue;
      const [x1, y1] = hexPixel(a.hex[0], a.hex[1]);
      const [x2, y2] = hexPixel(b.hex[0], b.hex[1]);
      desired.set(connKey(from, to), { x1, y1, x2, y2 });
    }

    // Remove stale connection graphics + pulses.
    for (const [key, cg] of connectionGraphics) {
      if (!desired.has(key)) {
        cg.halo.destroy();
        cg.glow.destroy();
        cg.base.destroy();
        connectionGraphics.delete(key);
      }
    }
    for (const [key, p] of pulseEntries) {
      if (!desired.has(key)) {
        p.container.destroy({ children: true });
        pulseEntries.delete(key);
      }
    }

    // Add / update remaining connections.
    for (const [key, ep] of desired) {
      let cg = connectionGraphics.get(key);
      const endpointsChanged =
        !!cg &&
        (cg.x1 !== ep.x1 ||
          cg.y1 !== ep.y1 ||
          cg.x2 !== ep.x2 ||
          cg.y2 !== ep.y2);
      if (!cg) {
        const halo = new Graphics();
        const glow = new Graphics();
        glow.filters = [
          new GlowFilter({
            distance: 6,
            outerStrength: 2.5,
            innerStrength: 0,
            color: 0xfff0d0,
            quality: 0.15,
          }),
        ];
        const base = new Graphics();
        lineLayer.addChild(halo);
        lineLayer.addChild(glow);
        lineLayer.addChild(base);
        const sig = skeinSignature(key);
        const curve = computeSkeinCurve(ep.x1, ep.y1, ep.x2, ep.y2, sig);
        cg = {
          halo,
          glow,
          base,
          x1: ep.x1,
          y1: ep.y1,
          x2: ep.x2,
          y2: ep.y2,
          sig,
          curve,
        };
        connectionGraphics.set(key, cg);
      } else if (endpointsChanged) {
        cg.x1 = ep.x1;
        cg.y1 = ep.y1;
        cg.x2 = ep.x2;
        cg.y2 = ep.y2;
        cg.curve = computeSkeinCurve(ep.x1, ep.y1, ep.x2, ep.y2, cg.sig);
      }
      strokeConnection(cg, 1);

      // Rebuild this connection's pulse when it's new or its endpoints moved.
      // (Beads scale with arc length so a stale entry would draw at the wrong
      // size after a region snaps to new coords.)
      const existingPulse = pulseEntries.get(key);
      if (existingPulse && endpointsChanged) {
        existingPulse.container.destroy({ children: true });
        pulseEntries.delete(key);
      }
      if (!pulseEntries.has(key)) {
        const built = buildPulseEntry(cg.curve, cg.sig);
        if (built) {
          pulseLayer.addChild(built.container);
          pulseEntries.set(key, built);
          // Place beads on the curve so reduced-motion viewers see them at a
          // stable seeded position and the first animated frame has no jump.
          positionBeads(built, built.sig.phaseOffset);
        }
      }
    }

    // Symbols — load missing textures, then rebuild sprites
    const neededHrefs = new Set<string>();
    for (const r of skein.regions) {
      const href = `/${r.symbol}`;
      neededHrefs.add(href);
      if (!symbolTextureCache.has(href)) {
        try {
          const tex = (await Assets.load(href)) as Texture;
          symbolTextureCache.set(href, tex);
        } catch {
          // ignore missing symbol; skip sprite
        }
      }
    }

    const seenSlugs = new Set<string>();
    for (const r of skein.regions) {
      seenSlugs.add(r.slug);
      const tex = symbolTextureCache.get(`/${r.symbol}`);
      if (!tex) continue;
      let sprite = symbolSprites.get(r.slug);
      const [cx, cy] = hexPixel(r.hex[0], r.hex[1]);
      const size = 2.2;
      if (!sprite) {
        sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        sprite.width = size;
        sprite.height = size;
        sprite.eventMode = "static";
        sprite.cursor = "pointer";
        const slug = r.slug;
        sprite.on("pointerdown", (e: FederatedPointerEvent) => {
          e.stopPropagation();
          const region = skeinBySlug.get(slug);
          if (!region) return;
          const idx = factionIdxBySlug.get(region.faction) ?? null;
          if (idx !== null) {
            propsRef.current.onFactionClick(propsRef.current.factions[idx]);
          }
        });
        sprite.on("pointerover", () => {
          const region = skeinBySlug.get(slug);
          if (!region) return;
          const idx = factionIdxBySlug.get(region.faction) ?? null;
          propsRef.current.onSkeinHover(slug, idx);
        });
        sprite.on("pointerout", () => {
          propsRef.current.onSkeinHover(null, null);
        });
        symbolLayer.addChild(sprite);
        symbolSprites.set(r.slug, sprite);
      } else if (sprite.texture !== tex) {
        sprite.texture = tex;
      }
      sprite.position.set(cx, cy);
    }
    for (const [slug, sprite] of symbolSprites) {
      if (!seenSlugs.has(slug)) {
        sprite.destroy();
        symbolSprites.delete(slug);
      }
    }
  }

  function setSkeinVisible(v: boolean) {
    skeinLayer.visible = v;
  }

  // --- Replay animations ---
  // All overlays are short-lived Graphics added to `animLayer`. The snapshot
  // props that arrive on the same React render carry the final visual state;
  // overlays animate the transition on top, then destroy themselves on cleanup
  // and leave the snapshot to "carry through" as the resting state.
  const REGION_BORDER_MAX_MS = 700;
  const REGION_FILL_FADE_MS = 220;
  const SKEIN_LINK_MAX_MS = 600;
  const FLIP_WAVE_MAX_MS = 800;
  const PER_HEX_FLIP_MS = 280;

  function animateRegionBorder(slug: string, durationMs: number): void {
    const region = currentRegions.find((r) => r.slug === slug);
    const entry = regionEntries.get(slug);
    if (!region || !entry) return;
    const edges = orderEdgesIntoPath(computeRegionBorders(region.hexes));
    if (edges.length === 0) return;
    const totalLen = totalEdgeLength(edges);
    const overlay = new Graphics();
    overlay.filters = [
      new GlowFilter({
        distance: 4,
        outerStrength: 0.8,
        innerStrength: 0,
        color: 0xf0b46e,
        quality: 0.1,
      }),
    ];
    animLayer.addChild(overlay);
    entry.border.visible = false;
    // Hide the tint until the border completes — the fill is the resolution,
    // not the gesture; revealing it up-front gives the line nothing to "draw"
    // toward.
    entry.fill.alpha = 0;
    animMgr.start({
      startAt: performance.now(),
      durationMs,
      update: (t) => {
        const eased = easeOutCubic(t);
        const { full, tail } = partialEdgePath(edges, totalLen, eased);
        overlay.clear();
        drawEdgesPath(overlay, full);
        if (tail) {
          overlay.moveTo(tail[0], tail[1]).lineTo(tail[2], tail[3]);
        }
        overlay.stroke({
          color: "#f0b46e",
          width: 0.22,
          alpha: 0.55,
          cap: "round",
        });
      },
      cleanup: () => {
        overlay.destroy();
        // Restore the persistent border + tint if the entry still exists
        // (the region may have been removed mid-animation by a subsequent
        // layer scrub).
        const fresh = regionEntries.get(slug);
        if (!fresh) return;
        fresh.border.visible = true;
        // Bloom the fill in over a short fade so the tint settles rather
        // than popping.
        animMgr.start({
          startAt: performance.now(),
          durationMs: REGION_FILL_FADE_MS,
          update: (t) => {
            const e = regionEntries.get(slug);
            if (e) e.fill.alpha = easeOutCubic(t);
          },
          cleanup: () => {
            const e = regionEntries.get(slug);
            if (e) e.fill.alpha = 1;
          },
        });
      },
    });
  }

  function animateSkeinLink(
    from: string,
    to: string,
    durationMs: number,
  ): void {
    const key = connKey(from, to);
    const cg = connectionGraphics.get(key);
    if (!cg) return;
    // Suspend this connection's pulse beads until the line is fully drawn.
    const pulse = pulseEntries.get(key);
    if (pulse) pulse.container.visible = false;
    animMgr.start({
      startAt: performance.now(),
      durationMs,
      update: (t) => {
        strokeConnection(cg, easeOutCubic(t));
      },
      cleanup: () => {
        const fresh = connectionGraphics.get(key);
        if (fresh) strokeConnection(fresh, 1);
        const freshPulse = pulseEntries.get(key);
        if (freshPulse && !freshPulse.container.destroyed) {
          freshPulse.container.visible = true;
        }
      },
    });
  }

  function animateFactionFlips(
    flip: {
      originHex: readonly [number, number];
      hexes: ReadonlyArray<readonly [number, number]>;
      prevFactionIdxByHex: ReadonlyArray<readonly [string, number | null]>;
    },
    budgetMs: number,
  ): void {
    if (flip.hexes.length === 0) return;
    const prevByKey = new Map<string, number | null>(flip.prevFactionIdxByHex);

    // Sort by axial distance from origin, then group into rings.
    const ordered = flip.hexes
      .map((h) => ({ hex: h, d: axialDistance(h, flip.originHex) }))
      .sort((a, b) => a.d - b.d);
    const maxRing = ordered[ordered.length - 1].d;
    const ringCount = Math.max(1, maxRing + 1);

    // Per-hex flip stays at PER_HEX_FLIP_MS; the wave step shrinks as needed
    // so the *last* ring finishes inside the budget (with a floor so the wave
    // never strobes faster than 40ms per ring).
    const totalIfUnconstrained = ringCount * 80 + PER_HEX_FLIP_MS;
    const scale = Math.min(1, budgetMs / totalIfUnconstrained);
    const waveStepMs = Math.max(40, 80 * scale);

    const startAt = performance.now();
    interface FlipEntry {
      key: string;
      delay: number;
      underlying: Graphics | null; // current snapshot hex (now showing NEW color)
      overlay: Graphics | null; // overlay drawn with OLD color
      swapped: boolean;
    }
    const entries: FlipEntry[] = ordered.map(({ hex, d }) => {
      const key = `${hex[0]},${hex[1]}`;
      const underlying = factionHexByCoord.get(key) ?? null;
      const prevIdx = prevByKey.has(key) ? (prevByKey.get(key) ?? null) : null;
      const prevColor =
        prevIdx === null
          ? "#787c80"
          : (propsRef.current.factions[prevIdx]?.color ?? "#787c80");
      let overlay: Graphics | null = null;
      if (underlying) {
        // Hide underlying until the midpoint — overlay covers it with the OLD
        // color, then collapses & swaps to reveal the new color growing in.
        underlying.scale.y = 0;
        overlay = new Graphics();
        overlay.poly(LOCAL_HEX_VERTS);
        overlay.fill({ color: prevColor });
        overlay.stroke({ color: "#090c10", width: 0.2 });
        const [cx, cy] = hexPixel(hex[0], hex[1]);
        overlay.position.set(cx, cy);
        animLayer.addChild(overlay);
      }
      return {
        key,
        delay: d * waveStepMs,
        underlying,
        overlay,
        swapped: false,
      };
    });

    const totalMs =
      maxRing * waveStepMs + PER_HEX_FLIP_MS + 20; /* small tail */
    animMgr.start({
      startAt,
      durationMs: totalMs,
      update: () => {
        const now = performance.now();
        for (const e of entries) {
          const local = (now - startAt - e.delay) / PER_HEX_FLIP_MS;
          if (local <= 0) continue;
          if (local < 0.5) {
            if (e.overlay && !e.overlay.destroyed) {
              e.overlay.scale.y = 1 - local * 2;
            }
          } else if (local < 1) {
            if (!e.swapped) {
              if (e.overlay && !e.overlay.destroyed) e.overlay.visible = false;
              e.swapped = true;
            }
            if (e.underlying && !e.underlying.destroyed) {
              e.underlying.scale.y = (local - 0.5) * 2;
            }
          } else {
            if (!e.swapped) {
              if (e.overlay && !e.overlay.destroyed) e.overlay.visible = false;
              e.swapped = true;
            }
            if (e.underlying && !e.underlying.destroyed) {
              e.underlying.scale.y = 1;
            }
          }
        }
      },
      cleanup: () => {
        for (const e of entries) {
          if (e.overlay && !e.overlay.destroyed) e.overlay.destroy();
          if (e.underlying && !e.underlying.destroyed) {
            e.underlying.scale.y = 1;
          }
        }
      },
    });
  }

  function startAnimation(anim: LayerAnimation): void {
    if (reduced) return;
    const regionDur = Math.min(REGION_BORDER_MAX_MS, anim.budgetMs);
    for (const { slug } of anim.regionAdds) {
      animateRegionBorder(slug, regionDur);
    }
    const linkDur = Math.min(SKEIN_LINK_MAX_MS, anim.budgetMs);
    for (const { from, to } of anim.skeinConnects) {
      animateSkeinLink(from, to, linkDur);
    }
    const flipBudget = Math.min(FLIP_WAVE_MAX_MS, anim.budgetMs);
    for (const flip of anim.factionFlips) {
      animateFactionFlips(flip, flipBudget);
    }
  }

  function destroy() {
    app.ticker.remove(tickerCb);
    animMgr.clear();
    regionEntries.clear();
    symbolSprites.clear();
    symbolTextureCache.clear();
    pulseEntries.clear();
    connectionGraphics.clear();
    factionHexByCoord.clear();
    // World is shared with PixiHost — clean its children but leave the
    // container itself so the next HexMap mount can rebuild into it.
    while (world.children.length > 0) {
      const child = world.children[0];
      world.removeChild(child);
      child.destroy({ children: true });
    }
  }

  const handle: SceneHandle = {
    setRegions,
    setRegionsVisible,
    setHoveredRegion,
    setSkein: (s) => {
      void setSkein(s);
    },
    setSkeinVisible,
    setHoveredFaction,
    setFactionState,
    startAnimation,
    destroy,
  };
  return handle;
}
