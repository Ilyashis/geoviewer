import { describe, it, expect } from 'vitest';
import { sliceInline, sliceCrossline } from './volume';
import type { SeismicVolume } from './segy';

/** 2 inlines × 3 crosslines × 2 samples — amp[bin*2] = il*100 + xl identifies
 * which (il, xl) bin a sample came from, so slicing bugs show up as the
 * wrong number rather than needing a visual check. */
function buildVolume(): SeismicVolume {
  const nInline = 2, nCrossline = 3, nSamples = 2;
  const amp = new Float32Array(nInline * nCrossline * nSamples);
  const coordX = new Float64Array(nInline * nCrossline);
  const coordY = new Float64Array(nInline * nCrossline);
  for (let il = 0; il < nInline; il++) {
    for (let xl = 0; xl < nCrossline; xl++) {
      const bin = il * nCrossline + xl;
      amp[bin * nSamples] = il * 100 + xl;
      amp[bin * nSamples + 1] = -(il * 100 + xl);
      coordX[bin] = il * 10; coordY[bin] = xl * 10;
    }
  }
  return {
    id: 'v1', label: 'TEST-VOL', nInline, nCrossline, nSamples,
    inlineNumbers: [500, 501], crosslineNumbers: [900, 901, 902],
    dt: 2, t0: 0, amp, ampMax: 201, coordX, coordY, traceCount: nInline * nCrossline,
  };
}

describe('sliceInline', () => {
  it('extracts one crossline-major section at a fixed inline index', () => {
    const s = sliceInline(buildVolume(), 1);
    expect(s.nTraces).toBe(3); // one trace per crossline
    expect(s.nSamples).toBe(2);
    // inline index 1 → bin values 100, 101, 102 at sample 0
    expect([...s.amp.filter((_, i) => i % 2 === 0)]).toEqual([100, 101, 102]);
    expect(s.coords.map((c) => c.x)).toEqual([10, 10, 10]); // constant along the inline
    expect(s.coords.map((c) => c.y)).toEqual([0, 10, 20]);
  });

  it('carries the volume-wide ampMax, not a per-slice one', () => {
    // Slice 0's own peak magnitude is 2 (il=0 → values 0,1,2), but the
    // returned ampMax must stay the volume's 201 so colour scale doesn't
    // jump between slices.
    expect(sliceInline(buildVolume(), 0).ampMax).toBe(201);
  });

  it('rejects an out-of-range index', () => {
    expect(() => sliceInline(buildVolume(), 2)).toThrow(/инлайна/);
    expect(() => sliceInline(buildVolume(), -1)).toThrow(/инлайна/);
  });
});

describe('sliceCrossline', () => {
  it('extracts one inline-major section at a fixed crossline index', () => {
    const s = sliceCrossline(buildVolume(), 2);
    expect(s.nTraces).toBe(2); // one trace per inline
    // crossline index 2 → bin values 2 (il=0), 102 (il=1) at sample 0
    expect([...s.amp.filter((_, i) => i % 2 === 0)]).toEqual([2, 102]);
    expect(s.coords.map((c) => c.y)).toEqual([20, 20]); // constant along the crossline
    expect(s.coords.map((c) => c.x)).toEqual([0, 10]);
  });

  it('rejects an out-of-range index', () => {
    expect(() => sliceCrossline(buildVolume(), 3)).toThrow(/кросслайна/);
  });
});
