import { describe, it, expect } from 'vitest';
import { metricWells } from './coords';
import { projectLocal, EARTH_R } from '../core/crs';
import type { Well } from '../types';

function well(id: string, x?: number, y?: number, geodetic?: boolean): Well {
  return { id, name: id, depth: [], depthUnit: 'M', lithology: [], header: {}, curves: [], x, y, geodetic };
}

describe('projectLocal', () => {
  it('puts the reference point at the origin', () => {
    const p = projectLocal(60, 55, { lon0: 60, lat0: 55 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it('gives ~111 km per degree of latitude', () => {
    const p = projectLocal(60, 56, { lon0: 60, lat0: 55 });
    expect(p.y / 1000).toBeCloseTo(111.2, 0);
  });

  it('shrinks a degree of longitude by cos(lat)', () => {
    const p = projectLocal(61, 55, { lon0: 60, lat0: 55 });
    const expected = EARTH_R * (Math.PI / 180) * Math.cos(55 * (Math.PI / 180));
    expect(p.x).toBeCloseTo(expected, 3);
    expect(p.x).toBeLessThan(EARTH_R * (Math.PI / 180)); // less than a degree at the equator
  });
});

describe('metricWells', () => {
  it('leaves already-projected wells untouched', () => {
    const ws = [well('a', 12000, 48000), well('b', 12850, 48700)];
    expect(metricWells(ws)).toEqual(ws);
  });

  it('converts a lon/lat pair into a metric separation', () => {
    // Two wells 0.01° apart in latitude ≈ 1.11 km — the scale a real field spans.
    const out = metricWells([well('a', 60, 55, true), well('b', 60, 55.01, true)]);
    const dy = out[1].y! - out[0].y!;
    expect(dy).toBeCloseTo(1112, -1); // metres, not 0.01
    expect(out.every((w) => w.geodetic === false)).toBe(true);
  });

  it('centres the frame on the wells, so the origin sits between them', () => {
    const out = metricWells([well('a', 60, 55, true), well('b', 60.02, 55, true)]);
    expect(out[0].x!).toBeLessThan(0);
    expect(out[1].x!).toBeGreaterThan(0);
    expect(out[0].x! + out[1].x!).toBeCloseTo(0, 6); // symmetric about the mean
  });

  it('preserves relative geometry regardless of where the field sits', () => {
    const near = metricWells([well('a', 60, 55, true), well('b', 60.01, 55, true)]);
    const far = metricWells([well('a', 130, 55, true), well('b', 130.01, 55, true)]);
    expect(far[1].x! - far[0].x!).toBeCloseTo(near[1].x! - near[0].x!, 6);
  });

  it('passes a mixed set through without projecting the metric wells', () => {
    const out = metricWells([well('a', 60, 55, true), well('m', 500000, 6000000)]);
    expect(out[1].x).toBe(500000); // untouched
    expect(out[1].y).toBe(6000000);
    expect(Math.abs(out[0].x!)).toBeLessThan(1); // the sole geodetic well lands on its own mean
  });

  it('ignores geodetic wells with no coordinates', () => {
    const ws = [well('a', undefined, undefined, true), well('b', 100, 200)];
    expect(metricWells(ws)).toEqual(ws);
  });
});
