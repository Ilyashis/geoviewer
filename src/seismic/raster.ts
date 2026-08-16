import type { SeismicSection } from './section';
import type { TimeSlice } from './volume';

/** Dark variable-density seismic: near-black at zero, red for +, cyan-blue for −. */
export function seismicColor(v: number): [number, number, number] {
  const a = Math.min(1, Math.abs(v));
  return v >= 0 ? [30 + 225 * a, 34 + 36 * a, 34] : [30, 44 + 120 * a, 44 + 211 * a];
}

/** An off-screen canvas at 1px/trace × 1px/sample, for the view to stretch-blit at
 * whatever size the panel is — building the ImageData once per section instead of
 * per frame is what makes panning/zooming it affordable. */
export function buildSeismicRaster(section: SeismicSection): HTMLCanvasElement | null {
  const { nTraces, nSamples, amp, ampMax } = section;
  const off = document.createElement('canvas');
  off.width = nTraces; off.height = nSamples;
  const octx = off.getContext('2d');
  if (!octx) return null;
  const img = octx.createImageData(nTraces, nSamples);
  for (let i = 0; i < nTraces; i++) {
    for (let s = 0; s < nSamples; s++) {
      const [r, g, b] = seismicColor(amp[i * nSamples + s] / ampMax);
      const p = (s * nTraces + i) * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return off;
}

/** Same colour mapping, but for an areal (inline × crossline) time slice
 * instead of a trace × sample vertical section — inline down, crossline
 * across, matching how the volume view labels its axes. */
export function buildTimeSliceRaster(slice: TimeSlice): HTMLCanvasElement | null {
  const { nInline, nCrossline, amp, ampMax } = slice;
  const off = document.createElement('canvas');
  off.width = nCrossline; off.height = nInline;
  const octx = off.getContext('2d');
  if (!octx) return null;
  const img = octx.createImageData(nCrossline, nInline);
  for (let il = 0; il < nInline; il++) {
    for (let xl = 0; xl < nCrossline; xl++) {
      const [r, g, b] = seismicColor(amp[il * nCrossline + xl] / ampMax);
      const p = (il * nCrossline + xl) * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return off;
}
