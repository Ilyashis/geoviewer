import { describe, it, expect } from 'vitest';
import { volumetrics } from './volumetrics';
import type { Grid } from '../core/geom/grid';

/** A flat 10-m-thick grid over a 100×100 m area (2×2 cells, dx=dy=100). */
function flatGrid(thickness: number): Grid {
  const z = new Float64Array(4).fill(thickness);
  return { z, nx: 2, ny: 2, minX: 0, minY: 0, dx: 100, dy: 100, zmin: thickness, zmax: thickness };
}

describe('volumetrics', () => {
  it('computes GRV and STOOIP down the chain', () => {
    const r = volumetrics(flatGrid(10), { ng: 0.5, phi: 0.2, sw: 0.25, bo: 1.25, rf: 0.3 });
    // area = 4 cells × 100×100 = 40000 m² ; gross = 40000 × 10 = 400000 m³
    expect(r.areaKm2).toBeCloseTo(0.04, 6);
    expect(r.meanThickness).toBeCloseTo(10, 6);
    expect(r.grossM3).toBeCloseTo(400000, 3);
    expect(r.netM3).toBeCloseTo(200000, 3);       // ×0.5
    expect(r.poreM3).toBeCloseTo(40000, 3);        // ×0.2
    expect(r.hcpvM3).toBeCloseTo(30000, 3);        // ×(1−0.25)
    expect(r.stooipM3).toBeCloseTo(24000, 3);      // ÷1.25
    expect(r.stooipBbl).toBeCloseTo(24000 * 6.28981, 1);
    expect(r.recoverableBbl).toBeCloseTo(r.stooipBbl * 0.3, 4);
  });

  it('clips gross volume to the hydrocarbon column above a contact', () => {
    const th = flatGrid(10);
    // Top surface flat at 2000 → base at 2010.
    const top: Grid = { ...flatGrid(2000) };
    const p = { ng: 1, phi: 1, sw: 0, bo: 1, rf: 1 };

    // OWC below the base: whole thickness counts.
    expect(volumetrics(th, p, { owc: 2020, top }).grossM3).toBeCloseTo(400000, 3);
    // OWC halfway: 5 m HC column.
    const half = volumetrics(th, p, { owc: 2005, top });
    expect(half.grossM3).toBeCloseTo(200000, 3);
    expect(half.meanThickness).toBeCloseTo(5, 6);
    expect(half.areaKm2).toBeCloseTo(0.04, 6);
    // OWC above the top: nothing counts (all water).
    const dry = volumetrics(th, p, { owc: 1990, top });
    expect(dry.grossM3).toBe(0);
    expect(dry.areaKm2).toBe(0);
  });

  it('drops cells whose top is below the contact from the productive area', () => {
    const th = flatGrid(10);
    // Two cells crest at 2000, two at 2012 (below a 2006 contact).
    const top: Grid = { z: new Float64Array([2000, 2000, 2012, 2012]), nx: 2, ny: 2, minX: 0, minY: 0, dx: 100, dy: 100, zmin: 2000, zmax: 2012 };
    const r = volumetrics(th, { ng: 1, phi: 1, sw: 0, bo: 1, rf: 1 }, { owc: 2006, top });
    // Only the two crestal cells: HC column 6 m each → 2·6·10000 = 120000.
    expect(r.grossM3).toBeCloseTo(120000, 3);
    expect(r.areaKm2).toBeCloseTo(0.02, 6);
  });

  it('excludes cells outside a pinch-out polygon regardless of thickness', () => {
    const th = flatGrid(10); // 2×2 cells at (0,0) (100,0) (0,100) (100,100)
    const p = { ng: 1, phi: 1, sw: 0, bo: 1, rf: 1 };
    // Rectangle covering only the x=0 column (cells at x=0), excluding x=100.
    const leftHalf = [{ x: -10, y: -10 }, { x: 50, y: -10 }, { x: 50, y: 110 }, { x: -10, y: 110 }];
    const r = volumetrics(th, p, undefined, leftHalf);
    expect(r.grossM3).toBeCloseTo(200000, 3); // 2 cells × 10 m × 10000 m²
    expect(r.areaKm2).toBeCloseTo(0.02, 6);
  });

  it('a polygon with fewer than 3 points is treated as no boundary', () => {
    const th = flatGrid(10);
    const p = { ng: 1, phi: 1, sw: 0, bo: 1, rf: 1 };
    expect(volumetrics(th, p, undefined, [{ x: 0, y: 0 }, { x: 1, y: 1 }]).grossM3).toBeCloseTo(400000, 3);
  });

  it('ignores non-positive thickness cells', () => {
    const z = new Float64Array([10, -5, 0, 10]);
    const grid: Grid = { z, nx: 2, ny: 2, minX: 0, minY: 0, dx: 100, dy: 100, zmin: -5, zmax: 10 };
    const r = volumetrics(grid, { ng: 1, phi: 1, sw: 0, bo: 1, rf: 1 });
    // only two positive cells: 2 × 10 × 10000 = 200000
    expect(r.grossM3).toBeCloseTo(200000, 3);
    expect(r.areaKm2).toBeCloseTo(0.02, 6);
  });
});
