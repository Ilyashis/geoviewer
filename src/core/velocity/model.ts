/**
 * Time↔depth velocity model — the physics that ties the seismic time domain to
 * the well depth domain. Kept in the core so wells (checkshots, later) and
 * seismic share ONE conversion instead of each hard-coding a number.
 *
 * All times are two-way (TWT, ms); all depths are metres below the datum.
 * `const`  — a single velocity everywhere (the old behaviour).
 * `linear` — instantaneous V(z) = v0 + k·z, the classic compaction gradient:
 *            rocks get faster with depth, so the time axis stretches shallow and
 *            compresses deep. Its time↔depth pair is analytic (no integration).
 * `table`  — a measured time–depth relation (checkshots/VSP), interpolated.
 *            Real curves are not monotonic in velocity — a shallow low-velocity
 *            zone is common — so no analytic law reproduces them; the measured
 *            pairs are used directly and only extrapolated beyond their range.
 */
export type VelocityModel =
  | { kind: 'const'; v: number }        // m/s
  | { kind: 'linear'; v0: number; k: number } // v0 in m/s, k in 1/s
  | { kind: 'table'; pairs: { z: number; twt: number }[]; label?: string };

const FLAT = 1e-6; // |k| below this ⇒ treat linear as constant v0

/**
 * Piecewise-linear lookup on sorted pairs. Outside the sampled range the end
 * segment's gradient is continued rather than clamping, so a horizon slightly
 * shallower or deeper than the checkshots still converts instead of collapsing
 * onto the first or last sample.
 */
function interp(pairs: { a: number; b: number }[], a: number): number {
  const n = pairs.length;
  if (n === 0) return 0;
  if (n === 1) return pairs[0].b;
  const slopeAt = (i: number, j: number) => {
    const da = pairs[j].a - pairs[i].a;
    return da === 0 ? 0 : (pairs[j].b - pairs[i].b) / da;
  };
  if (a <= pairs[0].a) return pairs[0].b + (a - pairs[0].a) * slopeAt(0, 1);
  if (a >= pairs[n - 1].a) return pairs[n - 1].b + (a - pairs[n - 1].a) * slopeAt(n - 2, n - 1);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pairs[mid].a <= a) lo = mid; else hi = mid; }
  const t = pairs[hi].a === pairs[lo].a ? 0 : (a - pairs[lo].a) / (pairs[hi].a - pairs[lo].a);
  return pairs[lo].b + t * (pairs[hi].b - pairs[lo].b);
}

/** Instantaneous velocity (m/s) at a depth. */
export function velocityAt(m: VelocityModel, z: number): number {
  if (m.kind === 'const') return m.v;
  if (m.kind === 'linear') return m.v0 + m.k * z;
  // Instantaneous velocity from the local gradient of the measured curve.
  const dz = 1;
  const dt = depthToTwt(m, z + dz) - depthToTwt(m, z - dz);
  return dt > 0 ? (2000 * 2 * dz) / dt : avgVelocityTo(m, z || 1);
}

/** Depth (m) → two-way time (ms). Inverse of {@link twtToDepth} for the same model. */
export function depthToTwt(m: VelocityModel, z: number): number {
  if (m.kind === 'table') return interp(m.pairs.map((p) => ({ a: p.z, b: p.twt })), z);
  if (m.kind === 'const') return (2000 * z) / m.v;
  if (Math.abs(m.k) < FLAT) return (2000 * z) / m.v0;
  return (2000 * Math.log(1 + (m.k * z) / m.v0)) / m.k;
}

/** Two-way time (ms) → depth (m). Inverse of {@link depthToTwt} for the same model. */
export function twtToDepth(m: VelocityModel, twtMs: number): number {
  if (m.kind === 'table') return interp(m.pairs.map((p) => ({ a: p.twt, b: p.z })), twtMs);
  if (m.kind === 'const') return (m.v * twtMs) / 2000;
  if (Math.abs(m.k) < FLAT) return (m.v0 * twtMs) / 2000;
  return (m.v0 / m.k) * (Math.exp((m.k * twtMs) / 2000) - 1);
}

/** Average velocity (m/s) from the datum down to a depth — z / one-way time. */
export function avgVelocityTo(m: VelocityModel, z: number): number {
  if (z === 0) return velocityAt(m, 0);
  return (2000 * z) / depthToTwt(m, z);
}

/** Default: a single 2200 m/s — the demo's original constant conversion. */
export const DEFAULT_VELOCITY: VelocityModel = { kind: 'const', v: 2200 };

/**
 * A realistic compaction gradient (1800 m/s at the datum, +0.45 (m/s)/m). In real
 * data v0/k come from checkshots or a VSP; here it's a sensible demo preset whose
 * average to ~2 km lands near the old 2200 so tops don't jump when you switch.
 */
export const COMPACTION: VelocityModel = { kind: 'linear', v0: 1800, k: 0.45 };

/** A depth/time tie used to calibrate velocity — a marker's known depth and its picked TWT. */
export interface VelocitySample { depth: number; twt: number }

/**
 * Fit a linear model V(z)=v0+k·z to depth/TWT ties by least squares — the
 * seismic-to-well calibration: find the velocity that makes picked times convert
 * to the wells' known depths. Robust bounded grid + local refine (no divergence,
 * no derivatives); falls back to a constant when the gradient is negligible.
 */
export function calibrateVelocity(samples: VelocitySample[]): VelocityModel {
  const pts = samples.filter((s) => s.depth > 0 && s.twt > 0);
  if (pts.length < 2) return DEFAULT_VELOCITY;

  const sse = (v0: number, k: number) => {
    let s = 0;
    for (const p of pts) { const r = depthToTwt({ kind: 'linear', v0, k }, p.depth) - p.twt; s += r * r; }
    return s;
  };
  let best = { v0: 2000, k: 0, e: Infinity };
  const scan = (v0lo: number, v0hi: number, v0st: number, klo: number, khi: number, kst: number) => {
    for (let v0 = v0lo; v0 <= v0hi; v0 += v0st)
      for (let k = klo; k <= khi; k += kst) {
        const e = sse(v0, k);
        if (e < best.e) best = { v0, k, e };
      }
  };
  scan(1400, 3200, 25, 0, 1.0, 0.02);           // coarse
  scan(best.v0 - 25, best.v0 + 25, 2, Math.max(0, best.k - 0.02), best.k + 0.02, 0.002); // refine

  if (best.k < 0.01) return { kind: 'const', v: Math.round(best.v0) };
  return { kind: 'linear', v0: Math.round(best.v0), k: Math.round(best.k * 1000) / 1000 };
}
