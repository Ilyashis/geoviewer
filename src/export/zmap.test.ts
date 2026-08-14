import { describe, it, expect } from 'vitest';
import { buildZmapGrid } from './zmap';
import type { Grid } from '../core/geom/grid';

/** Fixed-width field extraction — the writer pads every value to 14 chars,
 * so slicing (not splitting on whitespace) is the honest way to check it. */
function fields(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i += 14) out.push(Number(line.slice(i, i + 14).trim()));
  return out;
}

function grid(z: number[], nx: number, ny: number): Grid {
  return { z: Float64Array.from(z), nx, ny, minX: 0, minY: 0, dx: 10, dy: 10, zmin: Math.min(...z), zmax: Math.max(...z) };
}

describe('buildZmapGrid', () => {
  it('header carries the @GRID FILE line and row/col/extent line', () => {
    const g = grid([1, 2, 3, 4], 2, 2);
    const out = buildZmapGrid(g, 'Top A');
    expect(out).toContain('@GRID FILE, GRID, 4');
    const dims = out.split('\n').find((l) => /^\s*2,\s*2,/.test(l));
    expect(dims).toBeDefined();
    expect(dims).toContain('0'); // minX
    expect(dims).toContain('10'); // maxX/maxY
  });

  it('data is column-major, north-up within each column', () => {
    // z row-major, row index increasing northward: (0,0)=1 (10,0)=2 (0,10)=3 (10,10)=4
    const g = grid([1, 2, 3, 4], 2, 2);
    const out = buildZmapGrid(g, 'Top A');
    const dataLine = out.trim().split('\n').pop()!;
    // column x=0 top-to-bottom (y=10 then y=0): 3, 1 — column x=10: 4, 2
    expect(fields(dataLine)).toEqual([3, 1, 4, 2]);
  });

  it('blank (NaN) cells become the ZMAP+ null sentinel, not an invented value', () => {
    const g = grid([NaN, 2, 3, 4], 2, 2);
    const out = buildZmapGrid(g, 'Top A');
    const dataLine = out.trim().split('\n').pop()!;
    expect(fields(dataLine)[1]).toBeGreaterThan(1e29); // z[0,0]=NaN is the second value written (column x=0, y=0)
  });

  it('wraps at VALUES_PER_LINE for a grid larger than one line', () => {
    const z = Array.from({ length: 9 }, (_, i) => i); // 3x3
    const g = grid(z, 3, 3);
    const out = buildZmapGrid(g, 'Top A');
    const dataLines = out.split('@\n')[1].trim().split('\n');
    expect(dataLines.length).toBe(3); // 9 values / 4 per line, rounded up
    expect(fields(dataLines[2])).toEqual([2]); // last line holds the remainder
  });
});
