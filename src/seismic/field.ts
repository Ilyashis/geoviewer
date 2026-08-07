import type { Marker, Well } from '../types';
import { buildSyntheticSection, type Reflector, type SeismicSection } from './section';

/** Two-way time (ms) for a depth at a constant velocity. */
const twt = (depth: number, v: number) => (2 * depth / v) * 1000;

export interface WellPost {
  id: string;
  name: string;
  /** Position along the line, 0 (left) … 1 (right). */
  xFrac: number;
  tops: { label: string; color: string; twt: number }[];
}

export interface FieldSection {
  section: SeismicSection;
  velocity: number;
  wells: WellPost[];
}

/**
 * A synthetic seismic line along the wells: reflectors trend with the mapped
 * tops (depth→TWT), with filler reflectors for a realistic look, and wells are
 * posted with their tops as tie markers. This is the demo bridge — a later stage
 * picks the horizon and feeds it to buildSurface.
 */
export function buildFieldSection(coordWells: Well[], markers: Marker[], velocity = 2200): FieldSection | null {
  const wells = coordWells.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y));
  if (wells.length < 2) return null;

  const xs = wells.map((w) => w.x!);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const span = Math.max(maxX - minX, 1);
  const xFrac = (x: number) => (x - minX) / span;

  const mappable = markers.filter((m) => wells.filter((w) => Number.isFinite(m.depths[w.id])).length >= 2);

  // A reflector per top: fit TWT vs position through its extreme picks.
  const markerReflectors: Reflector[] = [];
  let tMin = Infinity, tMax = -Infinity;
  for (const m of mappable) {
    const pts = wells
      .filter((w) => Number.isFinite(m.depths[w.id]))
      .map((w) => ({ f: xFrac(w.x!), t: twt(m.depths[w.id], velocity) }))
      .sort((a, b) => a.f - b.f);
    const first = pts[0], last = pts[pts.length - 1];
    const slope = last.f > first.f ? (last.t - first.t) / (last.f - first.f) : 0;
    const t0 = first.t - slope * first.f; // value at f = 0
    markerReflectors.push({ t0, dip: slope, fold: 8, amp: 0.9 });
    for (const p of pts) { if (p.t < tMin) tMin = p.t; if (p.t > tMax) tMax = p.t; }
  }
  if (!Number.isFinite(tMin)) { tMin = 800; tMax = 1400; }

  // Filler reflectors above and below the tops.
  const winStart = Math.max(0, tMin - 350), winEnd = tMax + 450;
  const filler: Reflector[] = [];
  for (let k = 0; k < 6; k++) {
    const t = winStart + ((k + 0.5) / 6) * (winEnd - winStart);
    filler.push({ t0: t, dip: 26 * Math.sin(k), fold: 11, amp: (k % 2 ? -1 : 1) * 0.4 });
  }

  const dt = 4;
  const t0 = Math.max(0, Math.round(winStart / dt) * dt);
  const nSamples = Math.max(60, Math.round((winEnd - t0) / dt));
  const section = buildSyntheticSection({
    nTraces: 260, nSamples, dt, t0, reflectors: [...filler, ...markerReflectors], freq: 26, noise: 0.05,
  });

  const posts: WellPost[] = wells.map((w) => ({
    id: w.id,
    name: w.name,
    xFrac: xFrac(w.x!),
    tops: mappable
      .filter((m) => Number.isFinite(m.depths[w.id]))
      .map((m) => ({ label: m.label, color: m.color, twt: twt(m.depths[w.id], velocity) })),
  }));

  return { section, velocity, wells: posts };
}
