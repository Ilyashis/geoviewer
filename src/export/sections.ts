import type { SectionLine } from '../store/slices/framework';

/** CSV-escape a field (quote if it contains delimiter, quote or newline). */
function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serialize cross-section lines to CSV: one row per polyline vertex, not one
 * per line — a single-row-per-line shape would have to throw the ломаная
 * away (`core/geom/line.ts`'s whole point is that a section can bend).
 */
export function buildSectionsCsv(sections: SectionLine[]): string {
  const lines = ['Section,Label,PointIndex,X,Y'];
  for (const s of sections) {
    s.points.forEach((p, i) => {
      lines.push([s.id, esc(s.label), String(i), String(p.x), String(p.y)].join(','));
    });
  }
  return lines.join('\n');
}
