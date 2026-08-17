import type { ControlPoint } from '../core/framework';

/** CSV-escape a field (quote if it contains delimiter, quote or newline). */
function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serialize seismic-picked horizons sent to the map to CSV: the same
 * control points (x, y, TVDSS) that feed `buildSurface` alongside the well
 * picks — one row per point, keyed by which пласт the horizon is tied to and
 * which line it was picked on (a horizon can be picked on more than one line).
 */
export function buildSeismicHorizonsCsv(horizons: Record<string, Record<string, ControlPoint[]>>): string {
  const lines = ['Horizon,Line,PointIndex,X,Y,Z'];
  for (const [label, byLine] of Object.entries(horizons)) {
    for (const [lineId, points] of Object.entries(byLine)) {
      points.forEach((p, i) => {
        lines.push([esc(label), esc(lineId), String(i), String(p.x), String(p.y), String(p.z)].join(','));
      });
    }
  }
  return lines.join('\n');
}
