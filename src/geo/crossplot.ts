import type { Marker, Well } from '../types';

/** One crossplot point: X/Y values, a Z (colour) value, and its source well. */
export interface Sample {
  x: number;
  y: number;
  z: number;
  wellId: string;
}

export interface Zone {
  top: Marker;
  base: Marker;
}

const findCurve = (w: Well, mnem: string) =>
  w.curves.find((c) => c.mnemonic.toLowerCase() === mnem.toLowerCase());

/** Union of curve mnemonics across wells, in first-seen order. */
export function curveMnemonics(wells: Well[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of wells) for (const c of w.curves) {
    if (!seen.has(c.mnemonic)) { seen.add(c.mnemonic); out.push(c.mnemonic); }
  }
  return out;
}

/**
 * Collect aligned (x, y, z) samples across wells for the chosen curves.
 * `zMnem` null ⇒ colour by depth. `zone` restricts samples to the MD interval
 * between the two markers' picks in each well.
 */
export function collectSamples(
  wells: Well[], xMnem: string, yMnem: string, zMnem: string | null, zone?: Zone | null,
): Sample[] {
  const out: Sample[] = [];
  for (const w of wells) {
    const xc = findCurve(w, xMnem), yc = findCurve(w, yMnem);
    if (!xc || !yc) continue;
    const zc = zMnem ? findCurve(w, zMnem) : null;

    let lo = -Infinity, hi = Infinity;
    if (zone) {
      const t = zone.top.depths[w.id], b = zone.base.depths[w.id];
      if (!Number.isFinite(t) || !Number.isFinite(b)) continue;
      lo = Math.min(t, b); hi = Math.max(t, b);
    }

    const n = w.depth.length;
    for (let i = 0; i < n; i++) {
      const d = w.depth[i];
      if (zone && (d < lo || d > hi)) continue;
      const x = xc.values[i], y = yc.values[i];
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      const zv = zc ? zc.values[i] : d;
      out.push({ x, y, z: zv == null || !Number.isFinite(zv) ? NaN : zv, wellId: w.id });
    }
  }
  return out;
}

/** Pearson correlation of the samples, optionally on log10-transformed axes. */
export function pearson(samples: Sample[], logX = false, logY = false): number {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (const s of samples) {
    const x = logX ? (s.x > 0 ? Math.log10(s.x) : NaN) : s.x;
    const y = logY ? (s.y > 0 ? Math.log10(s.y) : NaN) : s.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  if (n < 2) return NaN;
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  const d = Math.sqrt(vx * vy);
  return d > 0 ? cov / d : NaN;
}

export interface HistBin { x0: number; x1: number; count: number }

/** Equal-width histogram of finite values. */
export function histogram(values: number[], bins = 30): { bins: HistBin[]; max: number } {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0 || bins < 1) return { bins: [], max: 0 };
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min || 1;
  const w = span / bins;
  const counts = new Array(bins).fill(0);
  for (const x of v) {
    let k = Math.floor((x - min) / w);
    if (k >= bins) k = bins - 1;
    if (k < 0) k = 0;
    counts[k]++;
  }
  const out: HistBin[] = counts.map((count, i) => ({ x0: min + i * w, x1: min + (i + 1) * w, count }));
  return { bins: out, max: Math.max(...counts) };
}
