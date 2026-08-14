import type { Grid } from '../core/geom/grid';

/**
 * ZMAP+ ASCII grid — the industry interchange format Petrel reads natively
 * for gridded surfaces, letting a structure map built in GeoViewer open
 * directly as a Petrel surface. Field layout verified against GDAL's ZMAP+
 * reader/writer (frmts/zmap/zmapdataset.cpp), the closest thing this format
 * has to a public spec.
 */

const FIELD_WIDTH = 14;
const DECIMALS = 3;
const VALUES_PER_LINE = 4;
/** ZMAP+'s own null sentinel — the format's way of saying "no data", the
 *  same thing our blank (NaN) cells already mean. Not an invented value. */
const NULL_VALUE = 1e30;

function field(n: number): string {
  const v = Number.isFinite(n) ? n : NULL_VALUE;
  return v.toFixed(DECIMALS).padStart(FIELD_WIDTH);
}

/**
 * Serialize a structural grid (`buildSurface`'s output) to ZMAP+ ASCII.
 * Data is column-major, north-up within each column — for each X column
 * (west to east), values run from maxY down to minY — matching what
 * GDAL/Petrel readers assume for a north-up grid. Our own `Grid.z` is
 * row-major with row index increasing northward (`core/geom/grid.ts`), so
 * each column is walked top-to-bottom against that convention.
 */
export function buildZmapGrid(grid: Grid, name: string): string {
  const { z, nx, ny, minX, minY, dx, dy } = grid;
  const maxX = minX + dx * (nx - 1);
  const maxY = minY + dy * (ny - 1);

  const lines: string[] = [
    '!',
    `! ${name} — exported from GeoViewer`,
    '!',
    `@GRID FILE, GRID, ${VALUES_PER_LINE}`,
    `${String(FIELD_WIDTH).padStart(10)}, ${NULL_VALUE.toExponential(1)}, , ${DECIMALS}, 1`,
    `${String(ny).padStart(10)}, ${String(nx).padStart(10)}, ${minX}, ${maxX}, ${minY}, ${maxY}`,
    '0.0, 0.0, 0.0',
    '@',
  ];

  let row: string[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = ny - 1; j >= 0; j--) {
      row.push(field(z[j * nx + i]));
      if (row.length === VALUES_PER_LINE) { lines.push(row.join('')); row = []; }
    }
  }
  if (row.length > 0) lines.push(row.join(''));

  return lines.join('\n') + '\n';
}
