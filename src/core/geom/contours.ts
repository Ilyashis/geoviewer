import type { Grid } from './grid';

/** One contour segment in GRID index space (fractional i,j). */
export interface Segment { i0: number; j0: number; i1: number; j1: number }

/**
 * Marching squares: extract iso-line segments at `level` from a grid.
 * Coordinates are fractional grid indices (i in [0,nx-1], j in [0,ny-1]);
 * the caller maps them to pixels via the grid's origin/cell size.
 */
export function marchingSquares(grid: Grid, level: number): Segment[] {
  const { z, nx, ny } = grid;
  const segs: Segment[] = [];
  const at = (i: number, j: number) => z[j * nx + i];
  // Linear interpolation of the crossing point along a cell edge.
  const lerp = (a: number, b: number) => (level - a) / (b - a);

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const tl = at(i, j), tr = at(i + 1, j), br = at(i + 1, j + 1), bl = at(i, j + 1);
      // A blank corner means the grid has no value there. Comparisons against
      // NaN are all false, so without this the cell would silently read as
      // "below the level" and draw a contour along the edge of the data.
      if (!Number.isFinite(tl) || !Number.isFinite(tr) || !Number.isFinite(br) || !Number.isFinite(bl)) continue;
      let idx = 0;
      if (tl >= level) idx |= 8;
      if (tr >= level) idx |= 4;
      if (br >= level) idx |= 2;
      if (bl >= level) idx |= 1;
      if (idx === 0 || idx === 15) continue;

      // Edge crossing points (fractional grid coords).
      const top = () => ({ i: i + lerp(tl, tr), j });
      const right = () => ({ i: i + 1, j: j + lerp(tr, br) });
      const bottom = () => ({ i: i + lerp(bl, br), j: j + 1 });
      const left = () => ({ i, j: j + lerp(tl, bl) });

      const add = (a: { i: number; j: number }, b: { i: number; j: number }) =>
        segs.push({ i0: a.i, j0: a.j, i1: b.i, j1: b.j });

      switch (idx) {
        case 1: case 14: add(left(), bottom()); break;
        case 2: case 13: add(bottom(), right()); break;
        case 3: case 12: add(left(), right()); break;
        case 4: case 11: add(top(), right()); break;
        case 6: case 9: add(top(), bottom()); break;
        case 7: case 8: add(left(), top()); break;
        case 5: add(left(), top()); add(bottom(), right()); break;   // saddle
        case 10: add(left(), bottom()); add(top(), right()); break;  // saddle
      }
    }
  }
  return segs;
}
