import type { WellCheckshot } from '../wells/checkshot';

/** CSV-escape a field (quote if it contains delimiter, quote or newline). */
function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Serialize checkshots to CSV: one row per measured time–depth pair. */
export function buildCheckshotsCsv(checkshots: WellCheckshot[]): string {
  const lines = ['Well,MD,TVDSS,TWT'];
  for (const c of checkshots) {
    for (const p of c.points) {
      lines.push([esc(c.well), String(p.md), String(p.tvdss), String(p.twt)].join(','));
    }
  }
  return lines.join('\n');
}
