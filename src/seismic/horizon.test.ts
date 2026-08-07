import { describe, it, expect } from 'vitest';
import { buildSyntheticSection } from './section';
import { buildFieldSection } from './field';
import { autoTrackHorizon, horizonControls, sampleNodes, interpolateHorizon, tieToWells, sampleHorizonAt } from './horizon';
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

describe('sampleHorizonAt', () => {
  it('linearly interpolates between the two surrounding traces', () => {
    const h = new Float64Array([100, 200, 300, 400]);
    expect(sampleHorizonAt(h, 1.5)).toBeCloseTo(250, 6);
    expect(sampleHorizonAt(h, 0)).toBe(100);
    expect(sampleHorizonAt(h, 3)).toBe(400);
  });

  it('clamps a fractional index outside the array', () => {
    const h = new Float64Array([100, 200]);
    expect(sampleHorizonAt(h, -5)).toBe(100);
    expect(sampleHorizonAt(h, 50)).toBe(200);
  });
});

describe('tieToWells', () => {
  it('overwrites a node at a well trace with the exact well tie', () => {
    const field = buildFieldSection(wells, markers, 'x', DEFAULT_VELOCITY)!;
    const nTraces = field.section.nTraces;
    const wrong = sampleNodes(new Float64Array(nTraces).fill(1234), 5); // deliberately off
    const tied = tieToWells(field, 'Top A', wrong);
    const topA = (id: string) => field.wells.find((w) => w.id === id)!.tops.find((t) => t.label === 'Top A')!;
    expect(tied.find((n) => n.i === 0)!.twt).toBeCloseTo(topA('a').twt, 6);
    expect(tied.find((n) => n.i === nTraces - 1)!.twt).toBeCloseTo(topA('b').twt, 6);
  });

  it('inserts a node when no existing node sits on the well trace', () => {
    const field = buildFieldSection(wells, markers, 'x', DEFAULT_VELOCITY)!;
    const nTraces = field.section.nTraces;
    const nodes = [{ i: 40, twt: 1500 }, { i: 220, twt: 1600 }]; // neither at 0 or nTraces-1
    const tied = tieToWells(field, 'Top A', nodes);
    expect(tied).toHaveLength(4);
    expect(tied.map((n) => n.i)).toEqual([0, 40, 220, nTraces - 1]); // inserted + sorted
  });

  it('is a no-op for a label with no well ties', () => {
    const field = buildFieldSection(wells, markers, 'x', DEFAULT_VELOCITY)!;
    const nodes = sampleNodes(new Float64Array(field.section.nTraces).fill(1000), 5);
    expect(tieToWells(field, 'Nonexistent', nodes)).toEqual(nodes);
  });
});

describe('horizonControls → buildSurface (seismic feeds the framework)', () => {
  it('converts a horizon to depth control points along the line', () => {
    const field = buildFieldSection(wells, markers, 'x', DEFAULT_VELOCITY)!;
    const h = new Float64Array(field.section.nTraces).fill(1800);
    const controls = horizonControls(field, h, DEFAULT_VELOCITY);
    expect(controls).toHaveLength(field.section.nTraces);
    expect(controls[0].z).toBeCloseTo(twtToDepth(DEFAULT_VELOCITY, 1800), 3); // ≈ 1980 m
    expect(controls[0].x).toBeCloseTo(0, 6);
    expect(controls[controls.length - 1].x).toBeCloseTo(1000, 6); // spans the transect
  });

  it('the horizon control points build a surface via the shared service', () => {
    const field = buildFieldSection(wells, markers, 'x', DEFAULT_VELOCITY)!;
    const controls = horizonControls(field, autoTrackHorizon(field.section, 1850), DEFAULT_VELOCITY);
    const xs = controls.map((c) => c.x), ys = controls.map((c) => c.y);
    const surface = buildSurface(controls, { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), nx: 20, ny: 20 });
    expect(surface).not.toBeNull();
    expect(surface!.grid.z.length).toBe(400);
  });
});
