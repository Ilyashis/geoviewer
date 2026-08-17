import { describe, it, expect } from 'vitest';
import { fitSimilarity, applySimilarity } from './similarity';

describe('fitSimilarity / applySimilarity', () => {
  it('both tie points map exactly onto their target', () => {
    const a = { local: { x: 0, y: 0 }, map: { x: 1000, y: 2000 } };
    const b = { local: { x: 100, y: 0 }, map: { x: 1000, y: 2200 } }; // 90° rotation, 2x scale
    const s = fitSimilarity(a, b)!;
    expect(s).not.toBeNull();
    const pa = applySimilarity(s, a.local), pb = applySimilarity(s, b.local);
    expect(pa.x).toBeCloseTo(a.map.x, 6); expect(pa.y).toBeCloseTo(a.map.y, 6);
    expect(pb.x).toBeCloseTo(b.map.x, 6); expect(pb.y).toBeCloseTo(b.map.y, 6);
  });

  it('a pure translation carries a third point along unchanged in shape', () => {
    const a = { local: { x: 0, y: 0 }, map: { x: 500, y: 500 } };
    const b = { local: { x: 10, y: 0 }, map: { x: 510, y: 500 } };
    const s = fitSimilarity(a, b)!;
    const p = applySimilarity(s, { x: 5, y: 5 });
    expect(p.x).toBeCloseTo(505, 6);
    expect(p.y).toBeCloseTo(505, 6);
  });

  it('recovers scale and rotation correctly for a 45° rotated, 3x-scaled pair', () => {
    const a = { local: { x: 0, y: 0 }, map: { x: 0, y: 0 } };
    const b = { local: { x: 10, y: 0 }, map: { x: 30 * Math.SQRT1_2, y: 30 * Math.SQRT1_2 } }; // 45°, scale 3
    const s = fitSimilarity(a, b)!;
    expect(s.scale).toBeCloseTo(3, 6);
    const p = applySimilarity(s, { x: 20, y: 0 });
    expect(p.x).toBeCloseTo(60 * Math.SQRT1_2, 6);
    expect(p.y).toBeCloseTo(60 * Math.SQRT1_2, 6);
  });

  it('is null when the two local points coincide — nothing to fit', () => {
    const a = { local: { x: 5, y: 5 }, map: { x: 0, y: 0 } };
    const b = { local: { x: 5, y: 5 }, map: { x: 100, y: 100 } };
    expect(fitSimilarity(a, b)).toBeNull();
  });
});
