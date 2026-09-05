import type { SeismicVolume } from './segy';
import type { ControlPoint } from '../core/framework';
import { twtToDepth, type VelocityModel } from '../core/velocity';
import { applySimilarity, type Similarity } from '../core/geom/similarity';

/** Where a 3D pick starts: an (inline, crossline) bin index pair and a TWT. */
export interface Seed3D { il: number; xl: number; twt: number }

export interface Track3DOptions {
  /** Half-width of the search window around the neighbour's picked time,
   * ms. Same default as the 2D tracker so a cube and a line behave alike. */
  windowMs?: number;
  /** Minimum peak amplitude to accept, as a fraction of the volume's ampMax.
   * 0 (the default here, for parity with the 2D tracker) still requires a
   * strictly POSITIVE sample — but that lets positive NOISE count as a
   * pick, and one noise step is enough to bring a reflector that's really
   * outside the window (a fault throw) back inside it, so the fill crosses
   * the fault. The view defaults to 0.1 for that reason; callers that want
   * the pick to stop where the reflector does should set this above their
   * noise level. */
  minAmp?: number;
}

/**
 * A horizon tracked through a volume: one TWT per (inline, crossline) bin,
 * NaN where tracking never reached (dead bin, no positive peak in the
 * window, or cut off by such bins). Same bin layout as the volume's
 * `coordX`/`coordY`.
 */
export interface HorizonSurface {
  nInline: number;
  nCrossline: number;
  twt: Float64Array;
  seed: Seed3D;
  windowMs: number;
}

/**
 * Seeded region-growing pick of a peak (positive) reflector through a cube —
 * the 3D counterpart of `autoTrackHorizon`. Grows outward from the seed bin
 * over the inline/crossline grid (4-neighbourhood, breadth-first); each new
 * bin picks the strongest positive amplitude within ±window of the time its
 * already-tracked neighbour landed on, exactly the rule the 2D tracker
 * applies trace-to-trace. Bins where that finds nothing positive stay NaN
 * and don't propagate, so the pick stops at a dead zone instead of inventing
 * a surface across it — and it flood-fills, so a horizon that's genuinely
 * cut (a fault throw larger than the window) ends at the cut rather than
 * jumping it.
 *
 * Breadth-first, not best-first: deterministic, no heap, and the window rule
 * already keeps each step local. The known cost is that a wrong turn near
 * the seed propagates — same as in 2D, where the fix is a better seed or a
 * tighter window, both exposed to the user here.
 */
export function trackHorizon3D(v: SeismicVolume, seed: Seed3D, opts: Track3DOptions = {}): HorizonSurface {
  const { nInline, nCrossline, nSamples, dt, t0, amp, ampMax, coordX } = v;
  if (!(seed.il >= 0 && seed.il < nInline) || !(seed.xl >= 0 && seed.xl < nCrossline)) {
    throw new Error(`Семя вне куба: инлайн ${seed.il} (0..${nInline - 1}), кросслайн ${seed.xl} (0..${nCrossline - 1})`);
  }
  const windowMs = opts.windowMs ?? 26;
  const win = Math.max(1, Math.round(windowMs / dt));
  const threshold = (opts.minAmp ?? 0) * ampMax;
  const nBins = nInline * nCrossline;
  const twt = new Float64Array(nBins).fill(NaN);
  const sampleOf = new Int32Array(nBins).fill(-1);

  /** Strongest strictly-positive sample within ±win of `prev`, or -1. */
  const pickPeak = (bin: number, prev: number): number => {
    if (Number.isNaN(coordX[bin])) return -1; // no trace in this bin
    const base = bin * nSamples;
    let best = -1, bestV = threshold;
    for (let s = Math.max(0, prev - win); s <= Math.min(nSamples - 1, prev + win); s++) {
      const val = amp[base + s];
      if (val > bestV) { bestV = val; best = s; }
    }
    return best;
  };

  const seedBin = seed.il * nCrossline + seed.xl;
  const seedSample = Math.max(0, Math.min(nSamples - 1, Math.round((seed.twt - t0) / dt)));
  const s0 = pickPeak(seedBin, seedSample);
  const surface: HorizonSurface = { nInline, nCrossline, twt, seed, windowMs };
  if (s0 < 0) return surface; // nothing positive under the seed — an empty pick, honestly

  sampleOf[seedBin] = s0; twt[seedBin] = t0 + s0 * dt;
  const queue = new Int32Array(nBins);
  let head = 0, tail = 0;
  queue[tail++] = seedBin;
  while (head < tail) {
    const bin = queue[head++];
    const il = (bin / nCrossline) | 0, xl = bin - il * nCrossline;
    const prev = sampleOf[bin];
    // 4-neighbourhood over the (il, xl) grid.
    const nbs = [
      il > 0 ? bin - nCrossline : -1,
      il < nInline - 1 ? bin + nCrossline : -1,
      xl > 0 ? bin - 1 : -1,
      xl < nCrossline - 1 ? bin + 1 : -1,
    ];
    for (const nb of nbs) {
      if (nb < 0 || sampleOf[nb] >= 0) continue; // off-grid or already tracked
      const s = pickPeak(nb, prev);
      if (s < 0) continue; // stays NaN; a different neighbour may still reach it
      sampleOf[nb] = s; twt[nb] = t0 + s * dt;
      queue[tail++] = nb;
    }
  }
  return surface;
}

/** The surface's trace along one inline (TWT per crossline) or one
 * crossline (TWT per inline) — what a vertical slice draws. */
export function surfaceProfile(surf: HorizonSurface, axis: 'inline' | 'crossline', index: number): Float64Array {
  const { nInline, nCrossline, twt } = surf;
  if (axis === 'inline') return twt.slice(index * nCrossline, (index + 1) * nCrossline);
  const out = new Float64Array(nInline);
  for (let il = 0; il < nInline; il++) out[il] = twt[il * nCrossline + index];
  return out;
}

export interface SurfaceStats { tracked: number; total: number; twtMin: number; twtMax: number }

export function surfaceStats(surf: HorizonSurface): SurfaceStats {
  let tracked = 0, twtMin = Infinity, twtMax = -Infinity;
  for (let i = 0; i < surf.twt.length; i++) {
    const t = surf.twt[i];
    if (Number.isNaN(t)) continue;
    tracked++;
    if (t < twtMin) twtMin = t;
    if (t > twtMax) twtMax = t;
  }
  return { tracked, total: surf.twt.length, twtMin: tracked ? twtMin : NaN, twtMax: tracked ? twtMax : NaN };
}

/** Bin stride that keeps a surface's control points near `target` in count —
 * `buildSurface` grids them again anyway, and a million-point control set
 * would only slow that down without adding structure the grid can hold. */
export function controlStepFor(tracked: number, target = 2000): number {
  return Math.max(1, Math.ceil(Math.sqrt(tracked / target)));
}

/**
 * Tracked surface → depth control points in the map's frame, one per
 * `step`-th bin in each direction — the cube's equivalent of
 * `horizonControls` for a line. Bins never tracked, or with no trace, are
 * skipped rather than filled. `xform` carries the volume's own coordinates
 * into the project CRS when it's been manually tied; without one they are
 * passed through as recorded.
 */
export function surfaceControls(v: SeismicVolume, surf: HorizonSurface, conv: VelocityModel, step: number, xform?: Similarity | null): ControlPoint[] {
  const out: ControlPoint[] = [];
  const { nInline, nCrossline } = surf;
  for (let il = 0; il < nInline; il += step) {
    for (let xl = 0; xl < nCrossline; xl += step) {
      const bin = il * nCrossline + xl;
      const t = surf.twt[bin];
      const x = v.coordX[bin], y = v.coordY[bin];
      if (Number.isNaN(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      const p = xform ? applySimilarity(xform, { x, y }) : { x, y };
      out.push({ x: p.x, y: p.y, z: twtToDepth(conv, t) });
    }
  }
  return out;
}
