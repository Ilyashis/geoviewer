/** Probabilistic (Monte-Carlo) volumetrics over the recovery-chain parameters. */

const M3_TO_BBL = 6.289810;

/** Triangular distribution (low ≤ mode ≤ high). */
export interface Tri { low: number; mode: number; high: number }

export interface McParams { ng: Tri; phi: Tri; sw: Tri; bo: Tri; rf: Tri }

export interface Pcts { p90: number; p50: number; p10: number; mean: number }

export interface McResult {
  /** STOOIP, barrels. */
  stooip: Pcts;
  /** Recoverable oil, barrels. */
  recoverable: Pcts;
  samples: number;
}

/** Deterministic PRNG so results are stable across renders and testable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inverse-CDF triangular sample for a uniform u in [0,1). */
export function triSample(t: Tri, u: number): number {
  const { low: a, mode: c, high: b } = t;
  if (b <= a) return c;
  const fc = (c - a) / (b - a);
  return u < fc
    ? a + Math.sqrt(u * (b - a) * (c - a))
    : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Build symmetric triangular params from deterministic modes and a ± fractional spread. */
export function makeTriParams(base: { ng: number; phi: number; sw: number; bo: number; rf: number }, spread: number): McParams {
  const s = Math.max(0, spread);
  const unit = (m: number): Tri => ({ low: clamp(m * (1 - s), 0, 1), mode: clamp(m, 0, 1), high: clamp(m * (1 + s), 0, 1) });
  return {
    ng: unit(base.ng),
    phi: { low: Math.max(0, base.phi * (1 - s)), mode: base.phi, high: base.phi * (1 + s) },
    sw: unit(base.sw),
    bo: { low: Math.max(0.01, base.bo * (1 - s)), mode: base.bo, high: base.bo * (1 + s) },
    rf: unit(base.rf),
  };
}

/** Linear-interpolated quantile of an ascending-sorted array. */
function quantile(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function pcts(sortedAsc: Float64Array, sum: number): Pcts {
  // Exceedance convention: P90 is the low value (exceeded 90% of the time), P10 the high.
  return {
    p90: quantile(sortedAsc, 0.10),
    p50: quantile(sortedAsc, 0.50),
    p10: quantile(sortedAsc, 0.90),
    mean: sortedAsc.length ? sum / sortedAsc.length : 0,
  };
}

/**
 * Monte-Carlo STOOIP and recoverable from a fixed gross rock volume (m³) and
 * triangular recovery parameters. GRV (map geometry / contact) is deterministic;
 * uncertainty comes from N/G · φ · (1−Sw) · 1/Bo · RF.
 */
export function monteCarlo(grossM3: number, p: McParams, n = 5000, seed = 0x9e3779b9): McResult {
  const rng = mulberry32(seed);
  const sto = new Float64Array(n);
  const rec = new Float64Array(n);
  let sSto = 0, sRec = 0;
  for (let i = 0; i < n; i++) {
    const ng = triSample(p.ng, rng());
    const phi = triSample(p.phi, rng());
    const sw = triSample(p.sw, rng());
    const bo = triSample(p.bo, rng());
    const rf = triSample(p.rf, rng());
    const s = bo > 0 ? grossM3 * ng * phi * (1 - sw) / bo * M3_TO_BBL : 0;
    const r = s * rf;
    sto[i] = s; rec[i] = r; sSto += s; sRec += r;
  }
  sto.sort(); rec.sort();
  return { stooip: pcts(sto, sSto), recoverable: pcts(rec, sRec), samples: n };
}
