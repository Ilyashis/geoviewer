import { describe, it, expect } from 'vitest';
import { volumetrics } from './volumetrics';
import type { Grid } from './grid';

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

  it('ignores non-positive thickness cells', () => {
    const z = new Float64Array([10, -5, 0, 10]);
    const grid: Grid = { z, nx: 2, ny: 2, minX: 0, minY: 0, dx: 100, dy: 100, zmin: -5, zmax: 10 };
    const r = volumetrics(grid, { ng: 1, phi: 1, sw: 0, bo: 1, rf: 1 });
    // only two positive cells: 2 × 10 × 10000 = 200000
    expect(r.grossM3).toBeCloseTo(200000, 3);
    expect(r.areaKm2).toBeCloseTo(0.02, 6);
  });
});
