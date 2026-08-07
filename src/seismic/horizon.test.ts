import { describe, it, expect } from 'vitest';
import { buildSyntheticSection } from './section';
import { buildFieldSection } from './field';
import { autoTrackHorizon, horizonControls, twtToDepth } from './horizon';
import { buildSurface } from '../core/framework';
import type { Well, Marker } from '../types';

describe('twtToDepth', () => {
  it('inverts depth→TWT at the field velocity', () => {
    expect(twtToDepth(1818.18, 2200)).toBeCloseTo(2000, 1);
  });
});

describe('autoTrackHorizon', () => {
  it('follows a dipping reflector across the traces', () => {
    const s = buildSyntheticSection({ nTraces: 80, nSamples: 300, dt: 4, t0: 0, noise: 0, reflectors: [{ t0: 400, dip: 40, fold: 0, amp: 1 }] });
    const h = autoTrackHorizon(s, 400);
    expect(h[0]).toBeCloseTo(400, -0.7);              // near the seed at trace 0 (±~8 ms)
    expect(h[h.length - 1] - h[0]).toBeGreaterThan(28); // tracked the +40 ms dip
  });
});

const wells: Well[] = [
  { id: 'a', name: 'a', depth: [], depthUnit: 'M', lithology: [], header: {}, curves: [], x: 0, y: 0 },
  { id: 'b', name: 'b', depth: [], depthUnit: 'M', lithology: [], header: {}, curves: [], x: 1000, y: 500 },
];
const markers: Marker[] = [{ id: 'm', label: 'Top A', color: '#AF52DE', depths: { a: 2000, b: 2040 } }];

describe('horizonControls → buildSurface (seismic feeds the framework)', () => {
  it('converts a horizon to depth control points along the line', () => {
    const field = buildFieldSection(wells, markers, 2200)!;
    const h = new Float64Array(field.section.nTraces).fill(1800);
    const controls = horizonControls(field, h);
    expect(controls).toHaveLength(field.section.nTraces);
    expect(controls[0].z).toBeCloseTo(twtToDepth(1800, 2200), 3); // ≈ 1980 m
    expect(controls[0].x).toBeCloseTo(0, 6);
    expect(controls[controls.length - 1].x).toBeCloseTo(1000, 6); // spans the transect
  });

  it('the horizon control points build a surface via the shared service', () => {
    const field = buildFieldSection(wells, markers, 2200)!;
    const controls = horizonControls(field, autoTrackHorizon(field.section, 1850));
    const xs = controls.map((c) => c.x), ys = controls.map((c) => c.y);
    const surface = buildSurface(controls, { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), nx: 20, ny: 20 });
    expect(surface).not.toBeNull();
    expect(surface!.grid.z.length).toBe(400);
  });
});
