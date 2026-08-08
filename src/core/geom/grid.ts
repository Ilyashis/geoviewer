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
 * IDW interpolation onto a regular grid over [minX,maxX] × [minY,maxY].
 * Cell (i,j) center maps to data coords; weight = 1/d^power. A cell that lands
 * on a control point takes that point's value exactly.
 *
 * With `faultTraces`, a cell only draws from control points on its OWN side of
 * every trace — the grid doesn't smooth across a fault, so the surface steps
 * instead of blending through the discontinuity.
 */
export function idwGrid(
  points: ControlPoint[],
  minX: number, maxX: number, minY: number, maxY: number,
  nx: number, ny: number, power = 2,
  faultTraces?: Pt[][],
): Grid {
  const dx = nx > 1 ? (maxX - minX) / (nx - 1) : 0;
  const dy = ny > 1 ? (maxY - minY) / (ny - 1) : 0;
  const z = new Float64Array(nx * ny);
  let zmin = Infinity;
  let zmax = -Infinity;
  const faulted = faultTraces && faultTraces.length > 0;

  for (let j = 0; j < ny; j++) {
    const cy = minY + j * dy;
    for (let i = 0; i < nx; i++) {
      const cx = minX + i * dx;
      let num = 0;
      let den = 0;
      let exact = NaN;
      for (const p of points) {
        if (faulted && !sameFaultBlock({ x: cx, y: cy }, p, faultTraces!)) continue;
        const d2 = (cx - p.x) ** 2 + (cy - p.y) ** 2;
        if (d2 < 1e-9) { exact = p.z; break; }
        const w = 1 / Math.pow(d2, power / 2);
        num += w * p.z;
        den += w;
      }
      const val = Number.isNaN(exact) ? (den > 0 ? num / den : 0) : exact;
      z[j * nx + i] = val;
      if (val < zmin) zmin = val;
      if (val > zmax) zmax = val;
    }
  }

  return { z, nx, ny, minX, minY, dx, dy, zmin, zmax };
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
