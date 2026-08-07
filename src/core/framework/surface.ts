import { idwGrid, type Grid, type ControlPoint } from '../geom/grid';

/**
 * Structural framework — the integration point of the geological model.
 *
 * A Surface is a geological surface (a horizon/top, or a derived quantity like
 * thickness) defined by scattered control points and interpolated onto a shared
 * mesh. Control points are source-agnostic: today they come from well picks,
 * later they can come from seismic horizons — `buildSurface` merges and grids
 * whatever it is given. Consumers (maps, volumetrics) read the built Surface;
 * they never grid raw picks themselves.
 */

/** Regular mesh over a data-space bounding box (nx × ny cells). */
export interface Mesh {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  nx: number;
  ny: number;
}

export interface Surface {
  /** The scattered control points the surface was built from (any source). */
  controls: ControlPoint[];
  /** Interpolated grid on the mesh. */
  grid: Grid;
  /** Value range over the control points (for colour scaling / legends). */
  zmin: number;
  zmax: number;
}

/**
 * Interpolate control points onto the mesh (IDW). Returns null when
 * under-constrained (fewer than 3 points), matching the mappability rule.
 */
export function buildSurface(controls: ControlPoint[], mesh: Mesh): Surface | null {
  if (controls.length < 3) return null;
  const grid = idwGrid(controls, mesh.minX, mesh.maxX, mesh.minY, mesh.maxY, mesh.nx, mesh.ny);
  let zmin = Infinity, zmax = -Infinity;
  for (const c of controls) {
    if (c.z < zmin) zmin = c.z;
    if (c.z > zmax) zmax = c.z;
  }
  return { controls, grid, zmin, zmax };
}
