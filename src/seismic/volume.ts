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
