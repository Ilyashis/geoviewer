import type { SeismicSection } from './section';
import type { SeismicVolume } from './segy';

/** A single inline or crossline cut through a volume — a `SeismicSection`
 * (so the existing raster renderer needs no changes) plus the trace
 * coordinates along the cut, in trace order. */
export interface VolumeSlice extends SeismicSection {
  coords: { x: number; y: number }[];
}

function slice(v: SeismicVolume, axis: 'inline' | 'crossline', index: number): VolumeSlice {
  const bound = axis === 'inline' ? v.nInline : v.nCrossline;
  if (!(index >= 0 && index < bound)) {
    throw new Error(`Индекс ${axis === 'inline' ? 'инлайна' : 'кросслайна'} вне диапазона: ${index} (0..${bound - 1})`);
  }
  const nTraces = axis === 'inline' ? v.nCrossline : v.nInline;
  const nSamples = v.nSamples;
  const amp = new Float32Array(nTraces * nSamples);
  const coords: { x: number; y: number }[] = new Array(nTraces);
  for (let i = 0; i < nTraces; i++) {
    const bin = axis === 'inline' ? index * v.nCrossline + i : i * v.nCrossline + index;
    amp.set(v.amp.subarray(bin * nSamples, (bin + 1) * nSamples), i * nSamples);
    coords[i] = { x: v.coordX[bin], y: v.coordY[bin] };
  }
  // ampMax comes from the whole volume, not this slice — a per-slice max
  // would rescale the colour ramp on every index change, making amplitude
  // strength impossible to compare from one slice to the next.
  return { nTraces, nSamples, dt: v.dt, t0: v.t0, amp, ampMax: v.ampMax, coords };
}

export const sliceInline = (v: SeismicVolume, ilIndex: number): VolumeSlice => slice(v, 'inline', ilIndex);
export const sliceCrossline = (v: SeismicVolume, xlIndex: number): VolumeSlice => slice(v, 'crossline', xlIndex);

/** A constant-TWT cut across every inline/crossline at once — an areal map,
 * not a vertical section, so it isn't a `SeismicSection` at all (there's no
 * sample axis left once time is the fixed one). Complements inline/crossline
 * rather than being "the same slice a third way": a vertical section shows
 * structure with depth at one position, a time slice shows a horizon's or
 * fault's areal extent at one instant — different questions. */
export interface TimeSlice {
  nInline: number;
  nCrossline: number;
  /** Inline-major: amp[il * nCrossline + xl]. */
  amp: Float32Array;
  ampMax: number;
  /** The TWT this slice sits at, ms. */
  twt: number;
}

export function sliceTime(v: SeismicVolume, sampleIndex: number): TimeSlice {
  if (!(sampleIndex >= 0 && sampleIndex < v.nSamples)) {
    throw new Error(`Индекс отсчёта вне диапазона: ${sampleIndex} (0..${v.nSamples - 1})`);
  }
  const { nInline, nCrossline, nSamples } = v;
  const amp = new Float32Array(nInline * nCrossline);
  for (let bin = 0; bin < nInline * nCrossline; bin++) amp[bin] = v.amp[bin * nSamples + sampleIndex];
  return { nInline, nCrossline, amp, ampMax: v.ampMax, twt: v.t0 + sampleIndex * v.dt };
}
