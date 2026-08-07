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
 */
export type VelocityModel =
  | { kind: 'const'; v: number }        // m/s
  | { kind: 'linear'; v0: number; k: number }; // v0 in m/s, k in 1/s

const FLAT = 1e-6; // |k| below this ⇒ treat linear as constant v0

/** Instantaneous velocity (m/s) at a depth. */
export function velocityAt(m: VelocityModel, z: number): number {
  return m.kind === 'const' ? m.v : m.v0 + m.k * z;
}

/** Depth (m) → two-way time (ms). Inverse of {@link twtToDepth} for the same model. */
export function depthToTwt(m: VelocityModel, z: number): number {
  if (m.kind === 'const') return (2000 * z) / m.v;
  if (Math.abs(m.k) < FLAT) return (2000 * z) / m.v0;
  return (2000 * Math.log(1 + (m.k * z) / m.v0)) / m.k;
}

/** Two-way time (ms) → depth (m). Inverse of {@link depthToTwt} for the same model. */
export function twtToDepth(m: VelocityModel, twtMs: number): number {
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
