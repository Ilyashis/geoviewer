import type { Marker, Well } from '../types';
import { buildSyntheticSection, type Reflector, type SeismicSection } from './section';
import { depthToTwt, type VelocityModel } from '../core/velocity';

/**
 * The demo's *true* subsurface velocity — a compaction gradient. The section and
 * its tie markers are always synthesised from this, independent of whatever
 * conversion velocity the user applies afterwards. That's what makes calibration
 * honest: a naive constant misfits the wells, and fitting v0/k recovers this.
 */
export const EARTH: VelocityModel = { kind: 'linear', v0: 1900, k: 0.38 };

/** Which map axis a line is laid out along. */
export type LineAxis = 'x' | 'y';

export interface WellPost {
  id: string;
  name: string;
  /** Position along the line, 0 (first endpoint) … 1 (second). */
  f: number;
  tops: { label: string; color: string; twt: number; depth: number }[];
}

export interface FieldSection {
  section: SeismicSection;
  /** The true velocity the section was synthesised with (not the conversion model). */
  earth: VelocityModel;
  wells: WellPost[];
  /** Straight transect the traces run along, in map coordinates (trace frac 0→1 = p0→p1). */
  line: { p0: { x: number; y: number }; p1: { x: number; y: number } };
}

/**
 * A synthetic seismic line laid out along `axis` (its two endpoints are the
 * wells with the smallest and largest coordinate on that axis — 'x' gives a
 * west→east line, 'y' a south→north one, so two axes make two independent
 * crossing lines through the same field). Reflectors trend with the mapped tops
 * (depth→TWT through the true earth), with filler reflectors for a realistic
 * look, and wells are posted with their tops as tie markers. This is the demo
 * bridge — a later stage picks the horizon and feeds it to buildSurface.
 */
export function buildFieldSection(coordWells: Well[], markers: Marker[], axis: LineAxis = 'x', earth: VelocityModel = EARTH): FieldSection | null {
  const wells = coordWells.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y));
  if (wells.length < 2) return null;

  const pos = (w: Well) => (axis === 'x' ? w.x! : w.y!);
  const ps = wells.map(pos);
  const minP = Math.min(...ps), maxP = Math.max(...ps);
  const span = Math.max(maxP - minP, 1);
  const f = (w: Well) => (pos(w) - minP) / span;

  const mappable = markers.filter((m) => wells.filter((w) => Number.isFinite(m.depths[w.id])).length >= 2);

  // A reflector per top: fit TWT vs position through its extreme picks.
  const markerReflectors: Reflector[] = [];
  let tMin = Infinity, tMax = -Infinity;
  for (const m of mappable) {
    const pts = wells
      .filter((w) => Number.isFinite(m.depths[w.id]))
      .map((w) => ({ f: f(w), t: depthToTwt(earth, m.depths[w.id]) }))
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
    f: f(w),
    tops: mappable
      .filter((m) => Number.isFinite(m.depths[w.id]))
      .map((m) => ({ label: m.label, color: m.color, twt: depthToTwt(earth, m.depths[w.id]), depth: m.depths[w.id] })),
  }));

  const p0w = wells.reduce((a, b) => (pos(a) <= pos(b) ? a : b));
  const p1w = wells.reduce((a, b) => (pos(a) >= pos(b) ? a : b));
  const line = { p0: { x: p0w.x!, y: p0w.y! }, p1: { x: p1w.x!, y: p1w.y! } };

  return { section, earth, wells: posts, line };
}
