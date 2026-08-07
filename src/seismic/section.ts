/**
 * Seismic module (a peer of `wells`): a 2D section and a synthetic generator.
 *
 * A section is traces × time samples of amplitude — a raster the view renders.
 * For now the data is synthetic (reflectivity convolved with a Ricker wavelet +
 * noise), the same way wells were bootstrapped with demo LAS: browser-first,
 * reproducible, no backend. Real SEG-Y import lands in a later stage.
 */

export interface SeismicSection {
  nTraces: number;
  nSamples: number;
  /** Sample interval, ms. */
  dt: number;
  /** Start time (TWT), ms. */
  t0: number;
  /** Trace-major amplitudes: amp[trace * nSamples + sample]. */
  amp: Float32Array;
  /** Peak |amplitude| for colour normalisation. */
  ampMax: number;
}

/** A reflector across the line: TWT at trace 0, linear dip, gentle fold, coefficient. */
export interface Reflector {
  t0: number;   // ms at the first trace
  dip: number;  // ms change from first to last trace
  fold: number; // sinusoidal structure amplitude, ms
  amp: number;  // reflection coefficient (signed)
}

/** Deterministic PRNG so a section is stable across renders and testable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ricker wavelet kernel sampled at `dt` ms, central frequency `freq` Hz. */
function rickerKernel(freq: number, dt: number): Float32Array {
  const half = Math.max(4, Math.round((1.1 * (1000 / freq)) / dt));
  const k = new Float32Array(2 * half + 1);
  const a = Math.PI * Math.PI * freq * freq;
  for (let i = -half; i <= half; i++) {
    const t = (i * dt) / 1000; // seconds
    k[i + half] = (1 - 2 * a * t * t) * Math.exp(-a * t * t);
  }
  return k;
}

export interface SyntheticOpts {
  nTraces: number;
  nSamples: number;
  dt: number;
  t0?: number;
  reflectors: Reflector[];
  freq?: number;
  noise?: number;
  seed?: number;
}

/** Build a synthetic section: place reflectivity, convolve a Ricker wavelet, add noise. */
export function buildSyntheticSection(o: SyntheticOpts): SeismicSection {
  const { nTraces, nSamples, dt, reflectors } = o;
  const t0 = o.t0 ?? 0, freq = o.freq ?? 28, noise = o.noise ?? 0.06;
  const rng = mulberry32(o.seed ?? 0x51ede1);
  const wavelet = rickerKernel(freq, dt);
  const half = (wavelet.length - 1) / 2;

  const amp = new Float32Array(nTraces * nSamples);
  const refl = new Float32Array(nSamples);
  let ampMax = 1e-6;

  for (let i = 0; i < nTraces; i++) {
    refl.fill(0);
    const f = nTraces > 1 ? i / (nTraces - 1) : 0;
    for (const r of reflectors) {
      const tMs = r.t0 + r.dip * f + r.fold * Math.sin(f * Math.PI * 1.5);
      const s = Math.round((tMs - t0) / dt);
      if (s >= 0 && s < nSamples) refl[s] += r.amp * (0.75 + 0.5 * rng()); // lateral amplitude wobble
    }
    const base = i * nSamples;
    for (let s = 0; s < nSamples; s++) {
      let v = 0;
      const lo = Math.max(0, s - half), hi = Math.min(nSamples - 1, s + half);
      for (let u = lo; u <= hi; u++) v += refl[u] * wavelet[u - s + half];
      v += (rng() - 0.5) * 2 * noise;
      amp[base + s] = v;
      const av = Math.abs(v);
      if (av > ampMax) ampMax = av;
    }
  }

  return { nTraces, nSamples, dt, t0, amp, ampMax };
}
