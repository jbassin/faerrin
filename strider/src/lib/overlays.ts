export type OverlayId = "regions" | "skein";

export interface OverlaySpec {
  id: OverlayId;
  label: string;
  defaultVisible: boolean;
}

export const OVERLAYS: readonly OverlaySpec[] = [
  { id: "regions", label: "REGIONS", defaultVisible: true },
  { id: "skein", label: "SKEIN", defaultVisible: true },
] as const;

const OVERLAY_IDS = new Set<string>(OVERLAYS.map((o) => o.id));

function isOverlayId(value: string): value is OverlayId {
  return OVERLAY_IDS.has(value);
}

export function defaultVisibleOverlays(): Set<OverlayId> {
  return new Set(OVERLAYS.filter((o) => o.defaultVisible).map((o) => o.id));
}

export function parseOverlaysParam(raw: string | undefined): Set<OverlayId> {
  if (raw === undefined) return defaultVisibleOverlays();
  const out = new Set<OverlayId>();
  for (const token of raw.split(",")) {
    const id = token.trim();
    if (id && isOverlayId(id)) out.add(id);
  }
  return out;
}

export function serializeOverlaysParam(
  visible: Set<OverlayId>,
): string | undefined {
  const defaults = defaultVisibleOverlays();
  if (
    visible.size === defaults.size &&
    [...visible].every((id) => defaults.has(id))
  ) {
    return undefined;
  }
  return [...visible].sort().join(",");
}
