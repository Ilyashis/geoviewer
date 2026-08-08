import { describe, it, expect } from 'vitest';
import { idwGrid, contourLevels } from './grid';
import { marchingSquares } from './contours';

describe('idwGrid', () => {
  it('reproduces control-point values at their locations', () => {
    const pts = [
      { x: 0, y: 0, z: 100 },
      { x: 10, y: 0, z: 200 },
      { x: 0, y: 10, z: 300 },
      { x: 10, y: 10, z: 400 },
    ];
    const g = idwGrid(pts, 0, 10, 0, 10, 11, 11);
    // corners equal their control points
    expect(g.z[0]).toBeCloseTo(100, 3);                    // (0,0)
    expect(g.z[10]).toBeCloseTo(200, 3);                   // (10,0)
    expect(g.z[10 * 11]).toBeCloseTo(300, 3);              // (0,10)
    expect(g.z[10 * 11 + 10]).toBeCloseTo(400, 3);         // (10,10)
    expect(g.zmin).toBeCloseTo(100, 1);
    expect(g.zmax).toBeCloseTo(400, 1);
  });

  it('keeps interpolated values within the data range', () => {
    const pts = [{ x: 0, y: 0, z: 50 }, { x: 100, y: 100, z: 150 }];
    const g = idwGrid(pts, 0, 100, 0, 100, 20, 20);
    for (let k = 0; k < g.z.length; k++) {
      expect(g.z[k]).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(g.z[k]).toBeLessThanOrEqual(150 + 1e-6);
    }
  });

  it('a fault trace stops interpolation blending across it', () => {
    const pts = [{ x: 1, y: 1, z: 100 }, { x: 9, y: 1, z: 200 }];
    const trace = [{ x: 5, y: -10 }, { x: 5, y: 10 }];
    const kAt = (i: number, j: number) => j * 11 + i; // nx=11
    const noFault = idwGrid(pts, 0, 10, 0, 2, 11, 3);
    const faulted = idwGrid(pts, 0, 10, 0, 2, 11, 3, 2, [trace]);

    // Without a fault, a cell on the left still leans toward the right point.
    expect(noFault.z[kAt(4, 1)]).toBeGreaterThan(110);
    // With the fault, that same cell only ever sees the left point.
    expect(faulted.z[kAt(4, 1)]).toBeCloseTo(100, 3);
    // Symmetric on the other side.
    expect(noFault.z[kAt(6, 1)]).toBeLessThan(190);
    expect(faulted.z[kAt(6, 1)]).toBeCloseTo(200, 3);
  });
});

describe('contourLevels', () => {
  it('produces round levels inside the range', () => {
    expect(contourLevels(2000, 2080, 8)).toEqual([2010, 2020, 2030, 2040, 2050, 2060, 2070]);
  });
  it('is empty for a flat field', () => {
    expect(contourLevels(2000, 2000)).toEqual([]);
  });
});

describe('marchingSquares', () => {
  it('cuts a planar field with a straight iso-line', () => {
    // z increases with i only → level 1.5 crosses between columns 1 and 2.
    const nx = 4, ny = 3;
    const z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = i;
    const grid = { z, nx, ny, minX: 0, minY: 0, dx: 1, dy: 1, zmin: 0, zmax: 3 };
    const segs = marchingSquares(grid, 1.5);
    expect(segs.length).toBeGreaterThan(0);
    // every crossing sits at i = 1.5 (vertical iso-line)
    for (const s of segs) {
      expect(s.i0).toBeCloseTo(1.5, 6);
      expect(s.i1).toBeCloseTo(1.5, 6);
    }
  });
});
