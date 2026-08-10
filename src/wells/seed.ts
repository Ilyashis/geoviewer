/**
 * Suggesting a starting depth for a marker in a well that doesn't have one
 * picked yet — not correlation (see `wells/correlate.ts`, and its measured
 * accuracy in docs/product/correlation.md, for why that isn't wired up), just
 * the least-wrong number to start dragging from instead of a flat MD line.
 *
 * Today's default is a single MD repeated across every well. That is wrong
 * twice over: formations dip, so the same depth is rarely the same bed two
 * wells apart — and it ignores the datum entirely, so a top at 2500 m MD in a
 * well with KB 40 m lands at 2500 m MD in a neighbour with KB 15 m, which is
 * 25 m of pure elevation error before geology even enters the picture.
 *
 * TVDSS already strips out KB and deviation — it's the quantity the map and
 * the 3D scene grid on, precisely because raw MD isn't comparable across
 * wells. Seeding in TVDSS and converting back to each well's own MD removes
 * the datum error; it does nothing about dip, which is why this stays a
 * seed for the geologist to drag, not a proposal with a confidence number.
 */

import type { Well } from '../types';
import { tvdss } from '../core/crs';
import { computeTrajectory, tvdAtMd, type TrajPoint } from './deviation';

/**
 * Inverse of `tvdAtMd`: the measured depth at which a trajectory reaches a
 * given true vertical depth. TVD is non-decreasing along MD for any physical
 * well path (inclination never exceeds 90°), so the search mirrors
 * `positionAtMd`'s segment walk exactly, just swapping which axis is known.
 */
export function mdAtTvd(traj: TrajPoint[], tvd: number): number {
  const n = traj.length;
  if (n === 0) return tvd; // vertical fallback: MD = TVD
  if (n === 1 || tvd <= traj[0].tvd) {
    const p = traj[0];
    return p.md + (tvd - p.tvd); // vertical above the first station
  }
  for (let i = 1; i < n; i++) {
    if (tvd <= traj[i].tvd) {
      const a = traj[i - 1], b = traj[i];
      const span = b.tvd - a.tvd;
      const t = span > 0 ? (tvd - a.tvd) / span : 0;
      return a.md + (b.md - a.md) * t;
    }
  }
  // Below TD: extrapolate along the last segment's tangent.
  const a = traj[n - 2], b = traj[n - 1];
  const span = b.tvd - a.tvd;
  const k = span > 0 ? (tvd - b.tvd) / span : 0;
  return b.md + (b.md - a.md) * k;
}

export interface SeedSource {
  wellId: string;
  /** Straight-line distance to the well it was copied from, metres. */
  distance: number;
}

export interface SeedOutcome {
  depth: number;
  source: SeedSource | null;
}

/**
 * For every well in `wells` that has no entry in `known`, propose a depth by
 * carrying the TVDSS of its nearest (by wellhead location) already-known
 * neighbour. Wells that already have a depth pass through unchanged.
 *
 * Falls back to copying a known depth verbatim — no datum correction — when
 * neither well has coordinates to measure a distance by; a raw-MD guess is
 * still a better start than no marker at all on a schematic (coordinate-less)
 * import.
 */
export function seedMarkerDepths(
  wells: Well[], known: Readonly<Record<string, number>>,
): Record<string, SeedOutcome> {
  const sources = wells.filter((w) => known[w.id] !== undefined);
  const trajCache = new Map<string, TrajPoint[]>();
  const trajOf = (w: Well) => {
    let t = trajCache.get(w.id);
    if (!t) { t = w.survey?.length ? computeTrajectory(w.survey) : []; trajCache.set(w.id, t); }
    return t;
  };

  const out: Record<string, SeedOutcome> = {};
  for (const w of wells) {
    const own = known[w.id];
    if (own !== undefined) { out[w.id] = { depth: own, source: null }; continue; }

    let best: Well | null = null, bestD = Infinity;
    const hasCoords = Number.isFinite(w.x) && Number.isFinite(w.y);
    if (hasCoords) {
      for (const s of sources) {
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
        const d = Math.hypot(w.x! - s.x!, w.y! - s.y!);
        if (d < bestD) { bestD = d; best = s; }
      }
    }

    if (best) {
      const srcTvdss = tvdss(tvdAtMd(trajOf(best), known[best.id]), best.kb);
      const tgtTvd = srcTvdss + (w.kb ?? 0); // invert tvdss(tvd, kb) = tvd - kb
      out[w.id] = { depth: mdAtTvd(trajOf(w), tgtTvd), source: { wellId: best.id, distance: bestD } };
      continue;
    }

    // No coordinates on this well, or on any known well: nothing to measure a
    // distance by. Copy whichever known depth is available rather than
    // leaving the well without a starting point at all.
    const anyKnown = sources[0];
    if (anyKnown) out[w.id] = { depth: known[anyKnown.id], source: { wellId: anyKnown.id, distance: NaN } };
  }
  return out;
}
