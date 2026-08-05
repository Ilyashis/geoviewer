import type { Marker, Well } from '../types';

/** CSV-escape a field (quote if it contains delimiter, quote or newline). */
function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serialize markers to a tops CSV round-trippable with the importer:
 * columns Well, Surface, MD — one row per pick, wells in project order.
 */
export function buildTopsCsv(markers: Marker[], wells: Well[]): string {
  const lines = ['Well,Surface,MD'];
  for (const w of wells) {
    for (const m of markers) {
      const depth = m.depths[w.id];
      if (depth == null || !Number.isFinite(depth)) continue;
      lines.push(`${esc(w.name)},${esc(m.label)},${Number(depth.toFixed(2))}`);
    }
  }
  return lines.join('\n');
}
