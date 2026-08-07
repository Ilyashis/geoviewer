import { describe, it, expect } from 'vitest';
import { buildFieldSection } from './field';
import type { Well, Marker } from '../types';

function well(id: string, x: number): Well {
  return { id, name: id, depth: [], depthUnit: 'M', lithology: [], header: {}, curves: [], x, y: 0 };
}
const wells: Well[] = [well('a', 0), well('b', 500), well('c', 1000)];
const markers: Marker[] = [
  { id: 'm1', label: 'Top A', color: '#AF52DE', depths: { a: 2000, b: 2020, c: 2040 } },
  { id: 'm2', label: 'KP S8', color: '#FF9500', depths: { a: 2100, b: 2115, c: 2130 } },
];

describe('buildFieldSection', () => {
  it('builds a section along the wells and posts each with its tops', () => {
    const f = buildFieldSection(wells, markers, 2200)!;
    expect(f.section.nTraces).toBe(260);
    expect(f.section.amp.length).toBe(f.section.nTraces * f.section.nSamples);
    expect(f.wells.map((w) => w.name)).toEqual(['a', 'b', 'c']);
    expect(f.wells[0].xFrac).toBeCloseTo(0, 6);   // leftmost
    expect(f.wells[2].xFrac).toBeCloseTo(1, 6);   // rightmost
    expect(f.wells[0].tops).toHaveLength(2);
    // Top A at 2000 m, v=2200 → TWT = 2·2000/2200·1000 ≈ 1818 ms
    expect(f.wells[0].tops[0].twt).toBeCloseTo(1818.18, 1);
  });

  it('returns null with fewer than two positioned wells', () => {
    expect(buildFieldSection([well('a', 0)], markers)).toBeNull();
  });
});
