import { describe, it, expect } from 'vitest';
import { buildSyntheticSection } from './section';
import { buildFieldSection } from './field';
import { autoTrackHorizon, horizonControls, sampleNodes, interpolateHorizon } from './horizon';
import { buildSurface } from '../core/framework';
import { twtToDepth, DEFAULT_VELOCITY } from '../core/velocity';
import type { Well, Marker } from '../types';

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

describe('editable nodes', () => {
  it('samples evenly-spaced nodes covering the ends', () => {
    const h = new Float64Array(100).map((_, i) => 1000 + i);
    const nodes = sampleNodes(h, 5);
    expect(nodes).toHaveLength(5);
    expect(nodes[0].i).toBe(0);
    expect(nodes[4].i).toBe(99);
    expect(nodes[0].twt).toBe(1000);
  });

  it('interpolates the horizon linearly between edited nodes', () => {
    const h = interpolateHorizon([{ i: 0, twt: 100 }, { i: 10, twt: 200 }], 11);
    expect(h[0]).toBe(100);
    expect(h[5]).toBeCloseTo(150, 6); // midpoint
    expect(h[10]).toBe(200);
  });

  it('holds flat outside the node range', () => {
    const h = interpolateHorizon([{ i: 2, twt: 300 }, { i: 6, twt: 300 }], 10);
    expect(h[0]).toBe(300);
    expect(h[9]).toBe(300);
  });
});

describe('horizonControls → buildSurface (seismic feeds the framework)', () => {
  it('converts a horizon to depth control points along the line', () => {
    const field = buildFieldSection(wells, markers, DEFAULT_VELOCITY)!;
    const h = new Float64Array(field.section.nTraces).fill(1800);
    const controls = horizonControls(field, h, DEFAULT_VELOCITY);
    expect(controls).toHaveLength(field.section.nTraces);
    expect(controls[0].z).toBeCloseTo(twtToDepth(DEFAULT_VELOCITY, 1800), 3); // ≈ 1980 m
    expect(controls[0].x).toBeCloseTo(0, 6);
    expect(controls[controls.length - 1].x).toBeCloseTo(1000, 6); // spans the transect
  });

  it('the horizon control points build a surface via the shared service', () => {
    const field = buildFieldSection(wells, markers, DEFAULT_VELOCITY)!;
    const controls = horizonControls(field, autoTrackHorizon(field.section, 1850), DEFAULT_VELOCITY);
    const xs = controls.map((c) => c.x), ys = controls.map((c) => c.y);
    const surface = buildSurface(controls, { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), nx: 20, ny: 20 });
    expect(surface).not.toBeNull();
    expect(surface!.grid.z.length).toBe(400);
  });
});
