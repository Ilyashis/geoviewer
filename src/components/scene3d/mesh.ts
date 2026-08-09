/**
 * Turning gridded surfaces into GPU buffers.
 *
 * Kept free of three.js on purpose: the fiddly part is which cells may be
 * drawn at all, and that is pure arithmetic worth testing on its own. The
 * component only wraps these arrays in BufferAttributes.
 */

import type { Grid } from '../../core/geom/grid';

export interface MeshArrays {
  /** xyz per grid node, row-major. z is elevation (negated TVDSS). */
  positions: Float32Array;
  /** rgb per grid node, 0…1. */
  colors: Float32Array;
  /** Triangle indices; only cells with four known corners appear. */
  indices: Uint32Array;
}

const RAMP: [number, number, number][] = [
  [214, 69, 69], [232, 145, 58], [232, 207, 58], [91, 184, 91], [58, 163, 201], [58, 107, 201],
];

/** The map's colour ramp, in 0…1 floats. `t` runs shallow → deep. */
export function rampRgb(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(0.999, t)) * (RAMP.length - 1);
  const i = Math.floor(c), f = c - i;
  const a = RAMP[i], b = RAMP[i + 1] ?? RAMP[i];
  return [
    (a[0] + (b[0] - a[0]) * f) / 255,
    (a[1] + (b[1] - a[1]) * f) / 255,
    (a[2] + (b[2] - a[2]) * f) / 255,
  ];
}

/**
 * Build the arrays for one surface.
 *
 * Blank grid cells are "no data", not zero — the grid leaves them NaN so the
 * map does not invent structure, and the same must hold here: a cell is
 * triangulated only when all four of its corners are known. Unknown nodes stay
 * in the position buffer (indices address nodes by grid position) but are
 * given a finite placeholder, because a single NaN in the buffer poisons the
 * bounding sphere and the whole mesh silently disappears.
 */
export function surfaceMesh(grid: Grid): MeshArrays | null {
  const { nx, ny, z, minX, minY, dx, dy } = grid;
  if (nx < 2 || ny < 2) return null;

  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let k = 0; k < z.length; k++) {
    const v = z[k];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    sum += v; n++;
  }
  if (n === 0) return null;
  const fill = sum / n;
  const span = hi - lo || 1;

  const positions = new Float32Array(nx * ny * 3);
  const colors = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, o = k * 3;
      const v = z[k];
      const known = Number.isFinite(v);
      positions[o] = minX + i * dx;
      positions[o + 1] = minY + j * dy;
      positions[o + 2] = known ? v : fill;
      // z here is elevation; the map's ramp runs by depth, so it is inverted.
      const [r, g, b] = rampRgb(known ? (hi - v) / span : 0);
      colors[o] = r; colors[o + 1] = g; colors[o + 2] = b;
    }
  }

  const idx: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
      if (!Number.isFinite(z[a]) || !Number.isFinite(z[b]) ||
          !Number.isFinite(z[c]) || !Number.isFinite(z[d])) continue;
      idx.push(a, b, c, a, c, d);
    }
  }
  if (idx.length === 0) return null;

  return { positions, colors, indices: new Uint32Array(idx) };
}

/**
 * A fault drawn as a vertical curtain along its trace, from `zBottom` to
 * `zTop`. Two triangles per trace segment.
 */
export function faultCurtain(
  trace: { x: number; y: number }[], zBottom: number, zTop: number,
): { positions: Float32Array; indices: Uint32Array } | null {
  if (trace.length < 2) return null;
  const positions = new Float32Array(trace.length * 2 * 3);
  for (let i = 0; i < trace.length; i++) {
    const o = i * 6;
    positions[o] = trace[i].x; positions[o + 1] = trace[i].y; positions[o + 2] = zTop;
    positions[o + 3] = trace[i].x; positions[o + 4] = trace[i].y; positions[o + 5] = zBottom;
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < trace.length; i++) {
    const t0 = i * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
    idx.push(t0, b0, b1, t0, b1, t1);
  }
  return { positions, indices: new Uint32Array(idx) };
}
