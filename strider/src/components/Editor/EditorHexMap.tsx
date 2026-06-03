import { useEffect, useRef } from "react";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Polygon,
  Sprite,
  Texture,
} from "pixi.js";
import { GlowFilter } from "pixi-filters";
import type { Faction } from "@/lib/factions";
import type { Region, SkeinRegion, SkeinState } from "@/lib/layers";
import { computeRegionBorders, hexPixel } from "@/lib/hexUtils";
import {
  CURRENT_FACTION_HEXES,
  CURRENT_UNOWNED_HEXES,
  CURRENT_FACTION_BORDERS,
} from "@/lib/layers";
import {
  attachWorld,
  drawEdgesPath,
  hexVertsAtPixel,
} from "../HexMap/pixiScene";
import {
  computeSkeinCurve,
  skeinSignature,
  type SkeinCurve,
} from "../HexMap/skeinGeometry";
import styles from "./EditorView.module.css";

// Canonical skein connection key (matches the production HexMap implementation
// so signatures and curves agree between the two renderers).
function connKey(from: string, to: string): string {
  return from < to ? `${from}|${to}` : `${to}|${from}`;
}

// Walk a polyline and emit dash/gap segments preserving rhythm across vertices
// — without this, dashes restart at every vertex and the line reads as a
// chevron rather than a uniform dashed curve.
function dashedPolylinePath(
  g: Graphics,
  points: ReadonlyArray<readonly [number, number]>,
  dash: number,
  gap: number,
): void {
  if (points.length < 2 || dash <= 0 || gap <= 0) return;
  const period = dash + gap;
  let phase = 0; // distance walked within the current period
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen === 0) continue;
    const ux = (bx - ax) / segLen;
    const uy = (by - ay) / segLen;
    let cursor = 0;
    while (cursor < segLen) {
      const inDash = phase < dash;
      const remainInPhase = inDash ? dash - phase : period - phase;
      const step = Math.min(remainInPhase, segLen - cursor);
      if (inDash) {
        g.moveTo(ax + ux * cursor, ay + uy * cursor);
        g.lineTo(ax + ux * (cursor + step), ay + uy * (cursor + step));
      }
      cursor += step;
      phase = (phase + step) % period;
    }
  }
}

interface EditorHexMapProps {
  factions: Faction[];
  regions: Region[];
  skein: SkeinState;
  selectedHexes: Array<[number, number]>;
  pickedRegionSlug: string | null;
  pickedSkeinSlug: string | null;
  skeinConnectFrom: string | null;
  onHexClick: (q: number, r: number) => void;
}

interface SceneHandle {
  fit: (w: number, h: number) => void;
  setRegions: (regions: Region[]) => void;
  setPickedRegion: (slug: string | null) => void;
  setSkein: (skein: SkeinState) => void;
  setPickedSkein: (slug: string | null) => void;
  setSkeinConnectFrom: (slug: string | null) => void;
  setSelectedHexes: (hexes: Array<[number, number]>) => void;
  destroy: () => void;
}

export default function EditorHexMap(props: EditorHexMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    let cancelled = false;
    let app: Application | null = null;
    let resizeObs: ResizeObserver | null = null;
    let initialized = false;

    (async () => {
      const host = hostRef.current;
      if (!host) return;

      const a = new Application();
      await a.init({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      if (cancelled) {
        a.destroy(true, { children: true, texture: true });
        return;
      }
      app = a;
      initialized = true;
      host.appendChild(app.canvas);
      app.canvas.style.display = "block";
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";

      const scene = buildEditorScene(app, propsRef);
      sceneRef.current = scene;

      const cur = propsRef.current;
      scene.setRegions(cur.regions);
      scene.setPickedRegion(cur.pickedRegionSlug);
      scene.setSkein(cur.skein);
      scene.setPickedSkein(cur.pickedSkeinSlug);
      scene.setSkeinConnectFrom(cur.skeinConnectFrom);
      scene.setSelectedHexes(cur.selectedHexes);

      resizeObs = new ResizeObserver(() => {
        scene.fit(host.clientWidth, host.clientHeight);
      });
      resizeObs.observe(host);
      scene.fit(host.clientWidth, host.clientHeight);

      host.dataset.mapReady = "true";
    })();

    return () => {
      cancelled = true;
      resizeObs?.disconnect();
      sceneRef.current?.destroy();
      sceneRef.current = null;
      if (initialized && app) {
        app.destroy(true, { children: true, texture: true });
      }
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setRegions(props.regions);
  }, [props.regions]);

  useEffect(() => {
    sceneRef.current?.setPickedRegion(props.pickedRegionSlug);
  }, [props.pickedRegionSlug]);

  useEffect(() => {
    sceneRef.current?.setSkein(props.skein);
  }, [props.skein]);

  useEffect(() => {
    sceneRef.current?.setPickedSkein(props.pickedSkeinSlug);
  }, [props.pickedSkeinSlug]);

  useEffect(() => {
    sceneRef.current?.setSkeinConnectFrom(props.skeinConnectFrom);
  }, [props.skeinConnectFrom]);

  useEffect(() => {
    sceneRef.current?.setSelectedHexes(props.selectedHexes);
  }, [props.selectedHexes]);

  return <div ref={hostRef} className={styles.mapRoot} />;
}

function buildEditorScene(
  app: Application,
  propsRef: React.RefObject<EditorHexMapProps>,
): SceneHandle {
  const { world, fit } = attachWorld(app);

  const factionHexLayer = new Container();
  world.addChild(factionHexLayer);
  const factionBorderLayer = new Graphics();
  world.addChild(factionBorderLayer);
  const regionFillLayer = new Container();
  world.addChild(regionFillLayer);
  const regionBorderLayer = new Container();
  world.addChild(regionBorderLayer);
  const skeinLineLayer = new Container();
  world.addChild(skeinLineLayer);
  const skeinSymbolLayer = new Container();
  world.addChild(skeinSymbolLayer);
  const pickRingLayer = new Graphics();
  world.addChild(pickRingLayer);
  const connectPreviewLayer = new Graphics();
  world.addChild(connectPreviewLayer);
  const selectionFillLayer = new Container();
  world.addChild(selectionFillLayer);
  const selectionBorderLayer = new Graphics();
  selectionBorderLayer.filters = [
    new GlowFilter({
      distance: 6,
      outerStrength: 1.4,
      innerStrength: 0,
      color: 0x6dd5c0,
      quality: 0.15,
    }),
  ];
  world.addChild(selectionBorderLayer);

  // --- Faction hexes (always reactive to onHexClick) ---
  CURRENT_FACTION_HEXES.forEach((hexes, factionIdx) => {
    const faction = propsRef.current.factions[factionIdx];
    for (const [q, r] of hexes) {
      const [cx, cy] = hexPixel(q, r);
      const verts = hexVertsAtPixel(cx, cy);
      const g = new Graphics();
      g.poly(verts);
      g.fill({ color: faction.color });
      g.stroke({ color: "#090c10", width: 0.2 });
      g.eventMode = "static";
      g.cursor = "pointer";
      g.hitArea = new Polygon(verts);
      g.on("pointerdown", () => {
        propsRef.current.onHexClick(q, r);
      });
      factionHexLayer.addChild(g);
    }
  });

  // --- Unowned hexes (clickable so the editor can claim them) ---
  for (const [q, r] of CURRENT_UNOWNED_HEXES) {
    const [cx, cy] = hexPixel(q, r);
    const verts = hexVertsAtPixel(cx, cy);
    const g = new Graphics();
    g.poly(verts);
    g.fill({ color: "#787c80" });
    g.stroke({ color: "#090c10", width: 0.2 });
    g.eventMode = "static";
    g.cursor = "pointer";
    g.hitArea = new Polygon(verts);
    g.on("pointerdown", () => {
      propsRef.current.onHexClick(q, r);
    });
    factionHexLayer.addChild(g);
  }

  drawEdgesPath(factionBorderLayer, CURRENT_FACTION_BORDERS);
  factionBorderLayer.stroke({ color: "#090c10", width: 0.5, cap: "round" });

  // --- Regions state ---
  const regionEntries = new Map<
    string,
    { slug: string; fill: Graphics; border: Graphics }
  >();
  let currentRegions: Region[] = [];
  let pickedRegionSlug: string | null = null;

  function paintRegionFill(g: Graphics, region: Region, picked: boolean) {
    g.clear();
    for (const [q, r] of region.hexes) {
      const [cx, cy] = hexPixel(q, r);
      g.poly(hexVertsAtPixel(cx, cy));
      g.fill({ color: "#0a0d12", alpha: picked ? 0.55 : 0.4 });
    }
  }

  function paintRegionBorder(g: Graphics, region: Region, picked: boolean) {
    g.clear();
    drawEdgesPath(g, computeRegionBorders(region.hexes));
    g.stroke({
      color: picked ? "#6dd5c0" : "#f0b46e",
      width: picked ? 0.35 : 0.22,
      alpha: picked ? 0.9 : 0.55,
      cap: "round",
    });
    const glow = g.filters?.[0] as GlowFilter | undefined;
    if (glow) {
      glow.color = picked ? 0x6dd5c0 : 0xf0b46e;
      glow.outerStrength = picked ? 1.4 : 0.8;
    }
  }

  function setRegions(regions: Region[]) {
    currentRegions = regions;
    const seen = new Set<string>();
    for (const region of regions) {
      seen.add(region.slug);
      let entry = regionEntries.get(region.slug);
      if (!entry) {
        const fill = new Graphics();
        // Non-interactive: clicks pass through to the faction hex below, which
        // reports the actual clicked (q, r). Region-targeting modes resolve
        // the region from that coord via hexRegion; skein modes need the real
        // hex to find the node sitting on it.
        fill.eventMode = "none";
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
        entry = { slug: region.slug, fill, border };
        regionEntries.set(region.slug, entry);
      }
      const picked = pickedRegionSlug === region.slug;
      paintRegionFill(entry.fill, region, picked);
      paintRegionBorder(entry.border, region, picked);
    }
    for (const [slug, entry] of regionEntries) {
      if (!seen.has(slug)) {
        entry.fill.destroy();
        entry.border.destroy();
        regionEntries.delete(slug);
      }
    }
  }

  function setPickedRegion(slug: string | null) {
    if (slug === pickedRegionSlug) return;
    const prev = pickedRegionSlug;
    pickedRegionSlug = slug;
    for (const target of [prev, slug]) {
      if (!target) continue;
      const entry = regionEntries.get(target);
      if (!entry) continue;
      const region = currentRegions.find((r) => r.slug === target);
      if (!region) continue;
      const picked = target === pickedRegionSlug;
      paintRegionFill(entry.fill, region, picked);
      paintRegionBorder(entry.border, region, picked);
    }
    refreshPickRings();
  }

  // --- Skein ---
  let currentSkein: SkeinState = { regions: [], connections: [] };
  let pickedSkeinSlug: string | null = null;
  let skeinConnectFrom: string | null = null;

  const haloGraphics = new Graphics();
  const baseGraphics = new Graphics();
  skeinLineLayer.addChild(haloGraphics);
  skeinLineLayer.addChild(baseGraphics);

  const symbolSprites = new Map<string, Sprite>();
  const symbolTextureCache = new Map<string, Texture>();

  async function setSkein(skein: SkeinState) {
    currentSkein = skein;
    const skeinBySlug = new Map<string, SkeinRegion>();
    for (const r of skein.regions) skeinBySlug.set(r.slug, r);

    const curves: SkeinCurve[] = [];
    for (const { from, to } of skein.connections) {
      const a = skeinBySlug.get(from);
      const b = skeinBySlug.get(to);
      if (!a || !b) continue;
      const [x1, y1] = hexPixel(a.hex[0], a.hex[1]);
      const [x2, y2] = hexPixel(b.hex[0], b.hex[1]);
      const sig = skeinSignature(connKey(from, to));
      curves.push(computeSkeinCurve(x1, y1, x2, y2, sig));
    }

    haloGraphics.clear();
    baseGraphics.clear();
    for (const curve of curves) {
      const pts = curve.samples;
      if (pts.length < 2) continue;
      haloGraphics.moveTo(pts[0][0], pts[0][1]);
      baseGraphics.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        haloGraphics.lineTo(pts[i][0], pts[i][1]);
        baseGraphics.lineTo(pts[i][0], pts[i][1]);
      }
    }
    haloGraphics.stroke({ color: "#06080b", width: 2.0, cap: "round" });
    baseGraphics.stroke({
      color: "#f0b46e",
      width: 0.5,
      alpha: 0.85,
      cap: "round",
    });

    // Symbols (no interaction in the editor — editor uses hex clicks)
    for (const r of skein.regions) {
      const href = `/${r.symbol}`;
      if (!symbolTextureCache.has(href)) {
        try {
          const tex = (await Assets.load(href)) as Texture;
          symbolTextureCache.set(href, tex);
        } catch {
          // ignore
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
        sprite.eventMode = "none";
        skeinSymbolLayer.addChild(sprite);
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

    refreshPickRings();
    refreshConnectPreview();
  }

  function setPickedSkein(slug: string | null) {
    pickedSkeinSlug = slug;
    refreshPickRings();
    refreshConnectPreview();
  }

  function setSkeinConnectFrom(slug: string | null) {
    skeinConnectFrom = slug;
    refreshPickRings();
    refreshConnectPreview();
  }

  function refreshPickRings() {
    pickRingLayer.clear();
    const skeinBySlug = new Map<string, SkeinRegion>();
    for (const r of currentSkein.regions) skeinBySlug.set(r.slug, r);
    pickRingLayer.filters = [
      new GlowFilter({
        distance: 6,
        outerStrength: 2,
        innerStrength: 0,
        color: 0x6dd5c0,
        quality: 0.15,
      }),
    ];
    for (const slug of [skeinConnectFrom, pickedSkeinSlug]) {
      if (!slug) continue;
      const node = skeinBySlug.get(slug);
      if (!node) continue;
      const [cx, cy] = hexPixel(node.hex[0], node.hex[1]);
      pickRingLayer.circle(cx, cy, 1.8);
      pickRingLayer.stroke({
        color: "#6dd5c0",
        width: 0.35,
        alpha: 0.9,
      });
    }
  }

  function refreshConnectPreview() {
    connectPreviewLayer.clear();
    if (!skeinConnectFrom || !pickedSkeinSlug) {
      connectPreviewLayer.filters = [];
      return;
    }
    const skeinBySlug = new Map<string, SkeinRegion>();
    for (const r of currentSkein.regions) skeinBySlug.set(r.slug, r);
    const a = skeinBySlug.get(skeinConnectFrom);
    const b = skeinBySlug.get(pickedSkeinSlug);
    if (!a || !b) return;
    const [x1, y1] = hexPixel(a.hex[0], a.hex[1]);
    const [x2, y2] = hexPixel(b.hex[0], b.hex[1]);
    // Seed with the same canonical key the connection will use after commit so
    // the preview shows the curve the user will actually get.
    const sig = skeinSignature(connKey(skeinConnectFrom, pickedSkeinSlug));
    const curve = computeSkeinCurve(x1, y1, x2, y2, sig);
    dashedPolylinePath(connectPreviewLayer, curve.samples, 1.2, 0.8);
    connectPreviewLayer.stroke({
      color: "#6dd5c0",
      width: 0.45,
      alpha: 0.85,
      cap: "round",
    });
    connectPreviewLayer.filters = [
      new GlowFilter({
        distance: 4,
        outerStrength: 1.6,
        innerStrength: 0,
        color: 0x6dd5c0,
        quality: 0.15,
      }),
    ];
  }

  // --- Selection ---
  const selectionHexGraphics: Graphics[] = [];

  function setSelectedHexes(hexes: Array<[number, number]>) {
    for (const g of selectionHexGraphics) g.destroy();
    selectionHexGraphics.length = 0;

    for (const [q, r] of hexes) {
      const [cx, cy] = hexPixel(q, r);
      const verts = hexVertsAtPixel(cx, cy);
      const g = new Graphics();
      g.poly(verts);
      g.fill({ color: "#6dd5c0", alpha: 0.55 });
      g.eventMode = "static";
      g.cursor = "pointer";
      g.hitArea = new Polygon(verts);
      const qCap = q;
      const rCap = r;
      g.on("pointerdown", () => {
        propsRef.current.onHexClick(qCap, rCap);
      });
      selectionFillLayer.addChild(g);
      selectionHexGraphics.push(g);
    }

    selectionBorderLayer.clear();
    if (hexes.length > 0) {
      drawEdgesPath(selectionBorderLayer, computeRegionBorders(hexes));
      selectionBorderLayer.stroke({
        color: "#6dd5c0",
        width: 0.45,
        cap: "round",
      });
    }
  }

  function destroy() {
    regionEntries.clear();
    symbolSprites.clear();
    symbolTextureCache.clear();
    selectionHexGraphics.length = 0;
  }

  return {
    fit,
    setRegions,
    setPickedRegion,
    setSkein: (s) => {
      void setSkein(s);
    },
    setPickedSkein,
    setSkeinConnectFrom,
    setSelectedHexes,
    destroy,
  };
}
