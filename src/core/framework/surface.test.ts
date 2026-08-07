import { describe, it, expect } from 'vitest';
import { buildSurface } from './surface';
import type { ControlPoint } from '../../geo/grid';

const mesh = { minX: 0, maxX: 100, minY: 0, maxY: 100, nx: 11, ny: 11 };

describe('buildSurface', () => {
  it('grids control points and reports the value range', () => {
    const controls: ControlPoint[] = [
      { x: 0, y: 0, z: 10 },
      { x: 100, y: 0, z: 20 },
      { x: 50, y: 100, z: 30 },
    ];
    const s = buildSurface(controls, mesh)!;
    expect(s.zmin).toBe(10);
    expect(s.zmax).toBe(30);
    expect(s.grid.nx).toBe(11);
    expect(s.grid.z.length).toBe(121);
    expect(s.controls).toBe(controls);
    // A cell landing exactly on a control point takes that value (IDW).
    expect(s.grid.z[0]).toBeCloseTo(10, 6); // corner (0,0)
  });

  it('is source-agnostic — control points can come from anywhere', () => {
    const wellPicks: ControlPoint[] = [{ x: 0, y: 0, z: 2000 }, { x: 100, y: 0, z: 2010 }];
    const seismicHorizon: ControlPoint[] = [{ x: 50, y: 100, z: 2020 }];
    const s = buildSurface([...wellPicks, ...seismicHorizon], mesh)!;
    expect(s.controls).toHaveLength(3);
    expect(s.zmax).toBe(2020);
  });

  it('returns null when under-constrained (<3 points)', () => {
    expect(buildSurface([{ x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 2 }], mesh)).toBeNull();
  });
});
