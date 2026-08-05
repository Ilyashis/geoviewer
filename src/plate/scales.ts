import type { Curve, CurveStyle } from '../types';

/** Finite min/max of a numeric series, ignoring null/NaN. Returns null if empty. */
export function extent(values: (number | null)[]): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? [min, max] : null;
}

/** "Nice" rounded range for a curve, respecting explicit style min/max. */
export function curveRange(curve: Curve, style: CurveStyle): [number, number] {
  if (style.min != null && style.max != null) return [style.min, style.max];
  const ext = extent(curve.values);
  if (!ext) return style.scale === 'log' ? [0.2, 2000] : [0, 100];

  let [lo, hi] = ext;
  if (style.scale === 'log') {
    lo = lo <= 0 ? 0.2 : lo;
    // Snap to decades for a classic resistivity look.
    lo = Math.pow(10, Math.floor(Math.log10(lo)));
    hi = Math.pow(10, Math.ceil(Math.log10(hi)));
    if (lo === hi) hi = lo * 10;
    return [style.min ?? lo, style.max ?? hi];
  }

  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.05;
  return [style.min ?? lo - pad, style.max ?? hi + pad];
}

/** Map a value to a 0..1 fraction across a track, per scale type. */
export function valueToFrac(
  value: number,
  range: [number, number],
  scale: 'linear' | 'log'
): number {
  const [lo, hi] = range;
  if (scale === 'log') {
    const l = Math.log10(Math.max(value, 1e-9));
    return (l - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  }
  return (value - lo) / (hi - lo);
}
