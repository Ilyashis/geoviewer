import type { Well } from '../types';

function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serialize wells' lithology to a CSV round-trippable with the importer:
 * columns Well, Top, Base, Lithology, Saturation.
 */
export function buildLithologyCsv(wells: Well[]): string {
  const lines = ['Well,Top,Base,Lithology,Saturation'];
  for (const w of wells) {
    for (const iv of w.lithology) {
      lines.push(
        [
          esc(w.name),
          Number(iv.top.toFixed(2)),
          Number(iv.base.toFixed(2)),
          esc(iv.litho ?? ''),
          esc(iv.satName ?? ''),
        ].join(',')
      );
    }
  }
  return lines.join('\n');
}
