import type { SegyLine } from '../seismic/segy';
import { fitSimilarity, applySimilarity } from '../core/geom/similarity';

/** CSV-escape a field (quote if it contains delimiter, quote or newline). */
function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serialize imported SEG-Y lines to CSV: navigation only (one row per
 * trace's X/Y), not the amplitude raster — a raster is what the SEG-Y file
 * itself already is, and dumping nTraces×nSamples numbers into a CSV would
 * serve nobody. Coordinates run through the line's tie (`core/geom/
 * similarity.ts`) when it has one, same as everywhere else a tied line's
 * position is used — an untied line's raw coordinates are in the survey's
 * own, unresolved frame, so `Calibrated` says which one a row is.
 */
export function buildSegyLinesCsv(lines: SegyLine[]): string {
  const out = ['Line,Label,TraceIndex,X,Y,Calibrated'];
  for (const l of lines) {
    const xform = l.tie ? fitSimilarity(l.tie[0], l.tie[1]) : null;
    l.coords.forEach((p, i) => {
      const q = xform ? applySimilarity(xform, p) : p;
      out.push([l.id, esc(l.label), String(i), String(q.x), String(q.y), xform ? '1' : '0'].join(','));
    });
  }
  return out.join('\n');
}
