import { describe, it, expect } from 'vitest';
import { trackHorizon3D, surfaceProfile, surfaceStats, surfaceControls, controlStepFor } from './track3d';
import type { SeismicVolume } from './segy';
import { DEFAULT_VELOCITY, twtToDepth } from '../core/velocity';
import { fitSimilarity } from '../core/geom/similarity';

/**
 * A cube with one clean peak reflector whose sample index is `at(il, xl)`,
 * amplitude 1 there and a weaker trough two samples below (so "strongest
 * POSITIVE" is actually exercised — the trough is nearer to some windows'
 * centre). `dead` bins get no trace at all: NaN coordinate, all-zero amps —
 * exactly what `segyToVolume` leaves for a bin the file never had.
 */
function buildVolume(o: {
  nInline: number; nCrossline: number; nSamples: number;
  at: (il: number, xl: number) => number | null;
  dead?: (il: number, xl: number) => boolean;
}): SeismicVolume {
  const { nInline, nCrossline, nSamples } = o;
  const amp = new Float32Array(nInline * nCrossline * nSamples);
  const coordX = new Float64Array(nInline * nCrossline).fill(NaN);
  const coordY = new Float64Array(nInline * nCrossline).fill(NaN);
  for (let il = 0; il < nInline; il++) {
    for (let xl = 0; xl < nCrossline; xl++) {
      const bin = il * nCrossline + xl;
      if (o.dead?.(il, xl)) continue;
      coordX[bin] = 1000 + il * 25; coordY[bin] = 2000 + xl * 25;
      const s = o.at(il, xl);
      if (s == null) continue;
      amp[bin * nSamples + s] = 1;
      if (s + 2 < nSamples) amp[bin * nSamples + s + 2] = -0.8;
    }
  }
  return {
    id: 'v', label: 'T', nInline, nCrossline, nSamples,
    inlineNumbers: Array.from({ length: nInline }, (_, i) => 100 + i),
    crosslineNumbers: Array.from({ length: nCrossline }, (_, i) => 500 + i),
    dt: 4, t0: 0, amp, ampMax: 1, coordX, coordY, traceCount: nInline * nCrossline,
  };
}

describe('trackHorizon3D', () => {
  it('follows a reflector dipping in both inline and crossline from one seed', () => {
    // Sample index = 50 + il + xl: a plane dipping 4 ms per bin each way.
    const v = buildVolume({ nInline: 8, nCrossline: 10, nSamples: 100, at: (il, xl) => 50 + il + xl });
    const surf = trackHorizon3D(v, { il: 0, xl: 0, twt: 200 }, { windowMs: 12 });
    const st = surfaceStats(surf);
    expect(st.tracked).toBe(80); // every bin reached
    expect(surf.twt[0]).toBe(200);                    // seed bin: sample 50 × 4 ms
    expect(surf.twt[7 * 10 + 9]).toBe((50 + 7 + 9) * 4); // far corner, both dips accumulated
    expect(st.twtMin).toBe(200); expect(st.twtMax).toBe(264);
  });

  it('snaps the seed to the strongest positive peak within the window, not the given time', () => {
    const v = buildVolume({ nInline: 3, nCrossline: 3, nSamples: 100, at: () => 40 });
    // Seeded 8 ms (2 samples) off the peak, inside a 12 ms window.
    const surf = trackHorizon3D(v, { il: 1, xl: 1, twt: 168 }, { windowMs: 12 });
    expect(surf.twt[4]).toBe(160);
  });

  it('prefers the positive peak over a stronger-magnitude trough', () => {
    // Trough at s+2 has |amp| 0.8 < 1 here, so make the peak weaker than
    // the trough's magnitude to prove sign is what's being followed.
    const v = buildVolume({ nInline: 2, nCrossline: 2, nSamples: 60, at: () => 20 });
    for (let bin = 0; bin < 4; bin++) v.amp[bin * 60 + 20] = 0.3; // peak 0.3 vs trough −0.8
    const surf = trackHorizon3D(v, { il: 0, xl: 0, twt: 84 }, { windowMs: 16 }); // centred on the trough
    expect([...surf.twt]).toEqual([80, 80, 80, 80]);
  });

  it('returns an empty surface when there is nothing positive under the seed', () => {
    const v = buildVolume({ nInline: 3, nCrossline: 3, nSamples: 50, at: () => null });
    const surf = trackHorizon3D(v, { il: 1, xl: 1, twt: 100 });
    expect(surfaceStats(surf).tracked).toBe(0);
    expect(Number.isNaN(surfaceStats(surf).twtMin)).toBe(true);
  });

  it('stops at dead bins and does not leak through a full barrier of them', () => {
    // Crossline 4 has no trace anywhere: the grid is split in two.
    const v = buildVolume({ nInline: 4, nCrossline: 9, nSamples: 60, at: () => 30, dead: (_il, xl) => xl === 4 });
    const surf = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 });
    const st = surfaceStats(surf);
    expect(st.tracked).toBe(4 * 4); // only the seed's side
    for (let il = 0; il < 4; il++) {
      expect(Number.isNaN(surf.twt[il * 9 + 4])).toBe(true); // the barrier itself
      expect(Number.isNaN(surf.twt[il * 9 + 8])).toBe(true); // the far side, unreachable
    }
  });

  it('goes round a partial barrier instead of through it', () => {
    // Dead bins on crossline 4 for inlines 0..2 only — inline 3 is open.
    const v = buildVolume({ nInline: 4, nCrossline: 9, nSamples: 60, at: () => 30, dead: (il, xl) => xl === 4 && il < 3 });
    const surf = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 });
    expect(surfaceStats(surf).tracked).toBe(4 * 9 - 3); // everything but the 3 dead bins
    expect(surf.twt[0 * 9 + 8]).toBe(120);            // reached the far side via inline 3
  });

  it('does not jump a throw larger than the window', () => {
    // Reflector at sample 30 for xl < 5, at 45 (a 60 ms throw) for xl ≥ 5.
    const v = buildVolume({ nInline: 2, nCrossline: 10, nSamples: 80, at: (_il, xl) => (xl < 5 ? 30 : 45) });
    const narrow = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 }, { windowMs: 20 });
    expect(surfaceStats(narrow).tracked).toBe(2 * 5); // stops at the fault
    const wide = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 }, { windowMs: 80 });
    expect(surfaceStats(wide).tracked).toBe(2 * 10); // a window wider than the throw crosses it
  });

  it('without a floor, positive noise lets the fill creep across a throw wider than the window', () => {
    // A 32 ms throw against a ±20 ms window — but a faint +noise sample
    // sits just inside the window on the far side. From it, the next
    // bin's window reaches the real peak: the fault is crossed. This is
    // the failure the amplitude floor exists for.
    const v = buildVolume({ nInline: 1, nCrossline: 10, nSamples: 80, at: (_il, xl) => (xl < 5 ? 30 : 38) });
    v.amp[5 * 80 + 35] = 0.02; // noise at xl=5, 5 samples (20 ms) below the last good pick
    const noFloor = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 }, { windowMs: 20, minAmp: 0 });
    expect(surfaceStats(noFloor).tracked).toBe(10); // crept through
    expect(noFloor.twt[5]).toBe(140);                // via the noise sample, not a real peak
    const floored = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 }, { windowMs: 20, minAmp: 0.1 });
    expect(surfaceStats(floored).tracked).toBe(5);   // stops at the fault
  });

  it('respects a minimum-amplitude floor', () => {
    const v = buildVolume({ nInline: 2, nCrossline: 4, nSamples: 60, at: () => 30 });
    for (let xl = 2; xl < 4; xl++) for (let il = 0; il < 2; il++) v.amp[(il * 4 + xl) * 60 + 30] = 0.1; // weak side
    const surf = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 }, { minAmp: 0.5 });
    expect(surfaceStats(surf).tracked).toBe(4); // the 0.1 peaks are below 0.5 × ampMax
  });

  it('rejects a seed outside the grid', () => {
    const v = buildVolume({ nInline: 2, nCrossline: 2, nSamples: 10, at: () => 5 });
    expect(() => trackHorizon3D(v, { il: 2, xl: 0, twt: 0 })).toThrow(/Семя вне куба/);
    expect(() => trackHorizon3D(v, { il: 0, xl: -1, twt: 0 })).toThrow(/Семя вне куба/);
  });
});

describe('surfaceProfile', () => {
  it('reads one inline (per crossline) and one crossline (per inline)', () => {
    const v = buildVolume({ nInline: 3, nCrossline: 4, nSamples: 60, at: (il, xl) => 20 + il * 2 + xl });
    const surf = trackHorizon3D(v, { il: 0, xl: 0, twt: 80 }, { windowMs: 12 });
    expect([...surfaceProfile(surf, 'inline', 1)]).toEqual([88, 92, 96, 100]);   // il=1: (22 + xl) × 4
    expect([...surfaceProfile(surf, 'crossline', 2)]).toEqual([88, 96, 104]);    // xl=2: (22 + 2·il) × 4
  });
});

describe('surfaceControls', () => {
  it('subsamples tracked bins into depth control points at the bins\' coordinates', () => {
    const v = buildVolume({ nInline: 4, nCrossline: 4, nSamples: 60, at: () => 30 });
    const surf = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 });
    const pts = surfaceControls(v, surf, DEFAULT_VELOCITY, 2);
    expect(pts).toHaveLength(4); // (0,0) (0,2) (2,0) (2,2)
    expect(pts[0]).toEqual({ x: 1000, y: 2000, z: twtToDepth(DEFAULT_VELOCITY, 120) });
    expect(pts[3]).toEqual({ x: 1050, y: 2050, z: twtToDepth(DEFAULT_VELOCITY, 120) });
  });

  it('skips untracked bins rather than filling them', () => {
    const v = buildVolume({ nInline: 2, nCrossline: 4, nSamples: 60, at: () => 30, dead: (_il, xl) => xl >= 2 });
    const surf = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 });
    expect(surfaceControls(v, surf, DEFAULT_VELOCITY, 1)).toHaveLength(4);
  });

  it('carries coordinates through a tie transform when given one', () => {
    const v = buildVolume({ nInline: 2, nCrossline: 2, nSamples: 60, at: () => 30 });
    const surf = trackHorizon3D(v, { il: 0, xl: 0, twt: 120 });
    // Pure translation by (+10, +20).
    const xf = fitSimilarity({ local: { x: 1000, y: 2000 }, map: { x: 1010, y: 2020 } }, { local: { x: 1025, y: 2000 }, map: { x: 1035, y: 2020 } });
    const pts = surfaceControls(v, surf, DEFAULT_VELOCITY, 1, xf);
    expect(pts[0].x).toBeCloseTo(1010); expect(pts[0].y).toBeCloseTo(2020);
  });
});

describe('controlStepFor', () => {
  it('is 1 for small surfaces and grows with the square root of the count', () => {
    expect(controlStepFor(500)).toBe(1);
    expect(controlStepFor(2000)).toBe(1);
    expect(controlStepFor(8000)).toBe(2);
    expect(controlStepFor(200_000)).toBe(10);
  });
});
