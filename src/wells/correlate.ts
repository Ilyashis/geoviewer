/**
 * Propagating a marker between wells by log-shape matching.
 *
 * Placing a top on one well and dragging it across the rest is the single most
 * expensive thing a geologist does here: a field of twenty-eight wells and ten
 * surfaces is nearly three hundred manual placements, each starting from a flat
 * line at the same measured depth — the one depth that is certainly wrong,
 * since formations dip.
 *
 * What a correlator can honestly offer is a *proposal*: the depth in each well
 * where the log looks most like the log around the reference pick, plus how
 * convincing that resemblance is. It cannot decide whether the resemblance is
 * the same formation — that is geology, and it stays with the geologist. So
 * every result carries its coefficient, and the caller is expected to show it.
 */

import type { Curve, Well } from '../types';
import { pickCurves } from './petrophysics';

export interface CorrelationOptions {
  /** Half-height of the log window compared, in metres. */
  window: number;
  /** How far above and below the prior depth to look, in metres. */
  search: number;
  /** Resampling step for the comparison, in metres. */
  step: number;
  /** Proposals weaker than this are returned but flagged as unconvincing. */
  minR: number;
}

export const DEFAULT_CORRELATION: CorrelationOptions = {
  // ±15 m spans a bed and its neighbours: wide enough to carry a recognisable
  // shape, narrow enough that a dipping section doesn't blur it.
  window: 15,
  // ±120 m of relief across a field is generous; beyond it the correlator
  // starts finding *other* beds, which is worse than finding nothing.
  search: 120,
  step: 0.2,
  minR: 0.6,
};

export interface Proposal {
  wellId: string;
  wellName: string;
  /** Proposed measured depth, or null when the well has nothing to compare. */
  md: number | null;
  /** Normalised cross-correlation at that depth, −1…1. */
  r: number;
  /** Metres from the prior depth — how far the correlator moved the pick. */
  shift: number;
  /** Which curve was compared, for the report. */
  curve?: string;
  /** Why no proposal, when md is null. */
  reason?: 'нет кривой' | 'нет данных в интервале' | 'слишком короткий интервал';
}

/** Linear interpolation of a curve at one measured depth. */
export function sampleAt(depth: number[], values: (number | null)[], md: number): number | null {
  const n = Math.min(depth.length, values.length);
  if (n === 0) return null;
  // Depth is ascending in every file we read; a binary search keeps the
  // resampling below linear in the log length.
  let lo = 0, hi = n - 1;
  if (md < depth[0] || md > depth[n - 1]) return null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (depth[mid] <= md) lo = mid; else hi = mid;
  }
  const a = values[lo], b = values[hi];
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const span = depth[hi] - depth[lo];
  if (span <= 0) return a;
  const t = (md - depth[lo]) / span;
  return a + (b - a) * t;
}

/**
 * Resample a curve onto a uniform depth axis. Gaps stay as NaN rather than
 * being interpolated across — a washed-out interval is missing data, and
 * bridging it would invent the very shape we are about to match on.
 */
export function resample(
  depth: number[], values: (number | null)[], from: number, to: number, step: number,
): Float64Array {
  const n = Math.max(0, Math.floor((to - from) / step) + 1);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = sampleAt(depth, values, from + i * step);
    out[i] = v == null ? NaN : v;
  }
  return out;
}

/**
 * Normalised cross-correlation of `a` against the slice of `b` starting at
 * `offset`. Means and deviations are recomputed over the compared samples, so
 * two wells whose gamma ray is recorded in different units still match on
 * shape — which is the only thing that carries between them.
 *
 * Returns NaN when too few samples overlap or either side is flat.
 */
export function correlateAt(a: Float64Array, b: Float64Array, offset: number, minSamples: number): number {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[offset + i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++; sa += x; sb += y;
  }
  if (n < minSamples) return NaN;
  const ma = sa / n, mb = sb / n;

  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[offset + i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const u = x - ma, v = y - mb;
    num += u * v; da += u * u; db += v * v;
  }
  if (da <= 0 || db <= 0) return NaN; // a flat log correlates with nothing
  return num / Math.sqrt(da * db);
}

/** The curve to correlate on, and its name. GR carries lithology; resistivity is the fallback. */
function correlationCurve(well: Well): Curve | undefined {
  const p = pickCurves(well);
  return p.gr ?? p.res;
}

/**
 * Propose a depth for `marker` in each target well, given where it sits in the
 * reference well.
 *
 * `prior` lets the caller supply a better starting guess than "the same depth"
 * — an already-picked neighbouring surface, say. The search is centred on it,
 * and `shift` reports how far the correlator moved from it, which is often the
 * most informative number in the result.
 */
export function propagatePick(
  reference: { well: Well; md: number },
  targets: Well[],
  prior: (well: Well) => number = () => reference.md,
  opts: CorrelationOptions = DEFAULT_CORRELATION,
): Proposal[] {
  // minR не участвует в поиске — им судят результат (см. isConvincing).
  const { window, search, step } = opts;
  const refCurve = correlationCurve(reference.well);
  const out: Proposal[] = [];

  if (!refCurve) {
    return targets.map((w) => ({
      wellId: w.id, wellName: w.name, md: null, r: 0, shift: 0, reason: 'нет кривой',
    }));
  }

  const ref = resample(
    reference.well.depth, refCurve.values,
    reference.md - window, reference.md + window, step,
  );
  const known = [...ref].filter(Number.isFinite).length;
  const minSamples = Math.max(8, Math.floor(ref.length * 0.5));
  if (known < minSamples) {
    return targets.map((w) => ({
      wellId: w.id, wellName: w.name, md: null, r: 0, shift: 0, reason: 'слишком короткий интервал',
    }));
  }

  for (const w of targets) {
    const curve = correlationCurve(w);
    if (!curve) {
      out.push({ wellId: w.id, wellName: w.name, md: null, r: 0, shift: 0, reason: 'нет кривой' });
      continue;
    }
    const centre = prior(w);
    // One resample per well, then slide the reference window over it.
    const from = centre - search - window;
    const band = resample(w.depth, curve.values, from, centre + search + window, step);

    let bestR = -Infinity, bestOffset = -1;
    const lastOffset = band.length - ref.length;
    for (let off = 0; off <= lastOffset; off++) {
      const r = correlateAt(ref, band, off, minSamples);
      if (Number.isFinite(r) && r > bestR) { bestR = r; bestOffset = off; }
    }

    if (bestOffset < 0) {
      out.push({
        wellId: w.id, wellName: w.name, md: null, r: 0, shift: 0,
        curve: curve.mnemonic, reason: 'нет данных в интервале',
      });
      continue;
    }

    const md = from + (bestOffset + (ref.length - 1) / 2) * step;
    out.push({
      wellId: w.id, wellName: w.name, md, r: bestR,
      shift: md - centre, curve: curve.mnemonic,
    });
  }

  return out;
}

/** Convenience for the caller's summary line. */
export const isConvincing = (p: Proposal, opts: CorrelationOptions = DEFAULT_CORRELATION) =>
  p.md != null && p.r >= opts.minR;
