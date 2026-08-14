/** Inverse-distance-weighted gridding of scattered (x, y, z) control points. */

import type { Pt } from './polygon';
import { sameFaultBlock } from './fault';

export interface ControlPoint { x: number; y: number; z: number }

export interface Grid {
  z: Float64Array; // row-major, ny rows × nx cols
  nx: number;
  ny: number;
  minX: number;
  minY: number;
  dx: number; // cell size in x
  dy: number; // cell size in y
  zmin: number;
  zmax: number;
}

/**
 * How far a cell may reach for data before it is left blank.
 *
 * Without a limit, IDW answers everywhere — it will happily contour structure
 * across tens of kilometres of empty space between two clusters of wells, and
 * volumetrics will then count that invented area as reservoir.
 *
 * The limit is inferred from the data rather than configured, as twice the
 * 90th percentile of nearest-neighbour spacing. Both choices are load-bearing,
 * and measured against real fields:
 *
 *   - the *median* collapses on pads. Sidetracks share a wellhead, so half the
 *     spacings are metres, and a field of eight wells over 4 × 3 km blanked
 *     out entirely.
 *   - the *maximum* hands the whole map to one outlier: a single well far from
 *     the rest sets a radius wide enough to bridge every real gap.
 *
 * The 90th percentile is the sparsest *typical* spacing, and doubling it
 * reaches across it with room to spare.
 */
export function dataRadius(points: ControlPoint[]): number {
  if (points.length < 2) return Infinity; // nothing to infer spacing from
  const nn: number[] = [];
  for (const p of points) {
    let best = Infinity;
    for (const q of points) {
      if (q === p) continue;
      const d2 = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d2 < best) best = d2;
    }
    if (Number.isFinite(best)) nn.push(Math.sqrt(best));
  }
  if (!nn.length) return Infinity;
  nn.sort((a, b) => a - b);
  // Index over (n−1), not n: `floor(0.9·n)` lands on the maximum for any set
  // of ten or fewer, which hands the radius straight back to the outlier this
  // percentile exists to ignore.
  const p90 = nn[Math.floor(0.9 * (nn.length - 1))];
  // Every point on top of every other says nothing about spacing.
  return p90 > 0 ? p90 * 2 : Infinity;
}

/**
 * IDW interpolation onto a regular grid over [minX,maxX] × [minY,maxY].
 * Cell (i,j) center maps to data coords; weight = 1/d^power. A cell that lands
 * on a control point takes that point's value exactly.
 *
 * A cell with no control point within the search radius is left `NaN` — blank,
 * not zero. Zero is a real elevation: on a TVDSS map it reads as sea level, so
 * an unreachable cell used to draw a two-kilometre cliff rather than nothing.
 * `maxDistance` overrides the radius derived from the data.
 *
 * With `faultTraces`, a cell only draws from control points on its OWN side of
 * every trace — the grid doesn't smooth across a fault, so the surface steps
 * instead of blending through the discontinuity. A block containing no wells
 * is therefore blank too, which is exactly what is known about it.
 */
export function idwGrid(
  points: ControlPoint[],
  minX: number, maxX: number, minY: number, maxY: number,
  nx: number, ny: number, power = 2,
  faultTraces?: Pt[][],
  maxDistance?: number,
): Grid {
  const dx = nx > 1 ? (maxX - minX) / (nx - 1) : 0;
  const dy = ny > 1 ? (maxY - minY) / (ny - 1) : 0;
  const z = new Float64Array(nx * ny);
  let zmin = Infinity;
  let zmax = -Infinity;
  const faulted = faultTraces && faultTraces.length > 0;
  const radius = maxDistance ?? dataRadius(points);
  const r2 = radius === Infinity ? Infinity : radius * radius;

  for (let j = 0; j < ny; j++) {
    const cy = minY + j * dy;
    for (let i = 0; i < nx; i++) {
      const cx = minX + i * dx;
      let num = 0;
      let den = 0;
      let exact = NaN;
      let reached = false;
      for (const p of points) {
        if (faulted && !sameFaultBlock({ x: cx, y: cy }, p, faultTraces!)) continue;
        const d2 = (cx - p.x) ** 2 + (cy - p.y) ** 2;
        if (d2 > r2) continue;
        reached = true;
        if (d2 < 1e-9) { exact = p.z; break; }
        const w = 1 / Math.pow(d2, power / 2);
        num += w * p.z;
        den += w;
      }
      // Out of reach of every point ⇒ nothing is known here.
      const val = Number.isNaN(exact) ? (reached && den > 0 ? num / den : NaN) : exact;
      z[j * nx + i] = val;
      if (val < zmin) zmin = val;
      if (val > zmax) zmax = val;
    }
  }

  return { z, nx, ny, minX, minY, dx, dy, zmin, zmax };
}

/**
 * Bilinear sample of a grid at an arbitrary (x, y) — what the cross-section
 * tool walks along a drawn line to turn the map's structure grid into a
 * continuous trace instead of straight segments between wells.
 *
 * NaN outside the mesh, and NaN when any of the four surrounding cells is
 * blank: the same "no invented structure" rule `surfaceMesh` enforces for the
 * 3D scene applies here too, so a gap in well control shows as a gap in the
 * section rather than a smoothed-over guess.
 */
export function sampleGrid(grid: Grid, x: number, y: number): number {
  const { z, nx, ny, minX, minY, dx, dy } = grid;
  if (nx < 2 || ny < 2 || dx <= 0 || dy <= 0) return NaN;
  const fx = (x - minX) / dx, fy = (y - minY) / dy;
  if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return NaN;
  const i0 = Math.min(nx - 2, Math.floor(fx)), j0 = Math.min(ny - 2, Math.floor(fy));
  const tx = fx - i0, ty = fy - j0;
  const z00 = z[j0 * nx + i0], z10 = z[j0 * nx + i0 + 1];
  const z01 = z[(j0 + 1) * nx + i0], z11 = z[(j0 + 1) * nx + i0 + 1];
  if (![z00, z10, z01, z11].every(Number.isFinite)) return NaN;
  const top = z00 + (z10 - z00) * tx, bot = z01 + (z11 - z01) * tx;
  return top + (bot - top) * ty;
}

/** "Nice" rounded step so contour levels fall on round numbers. */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * pow;
}

/** Contour levels covering [zmin,zmax] at a nice interval (~targetCount lines). */
export function contourLevels(zmin: number, zmax: number, targetCount = 8): number[] {
  if (!(zmax > zmin)) return [];
  const step = niceStep((zmax - zmin) / targetCount);
  const levels: number[] = [];
  // Start strictly above zmin so we don't emit a degenerate edge contour.
  for (let v = (Math.floor(zmin / step) + 1) * step; v < zmax; v += step) levels.push(Number(v.toFixed(4)));
  return levels;
}
