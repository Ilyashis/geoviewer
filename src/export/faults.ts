import type { Marker } from '../types';
import type { FaultDef } from '../store/slices/framework';

/** CSV-escape a field (quote if it contains delimiter, quote or newline). */
function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serialize faults to CSV: one row per trace vertex, so the plan-view
 * polyline survives (a single-row-per-fault shape would have to throw the
 * shape away). Dip and which пласты a fault cuts are per-fault, not
 * per-vertex, so they repeat on every row rather than living only on the
 * first — a consumer filtering or reordering rows shouldn't lose them.
 * No throw column: throw is per (fault, пласт) — see `estimateThrow` — and
 * has no honest place in a table indexed by trace point instead.
 */
export function buildFaultsCsv(faults: FaultDef[], markers: Marker[]): string {
  const labelOf = (id: string) => markers.find((m) => m.id === id)?.label ?? id;
  const lines = ['Fault,Label,PointIndex,X,Y,Dip,Cuts'];
  for (const f of faults) {
    const cuts = f.markerIds.map(labelOf).join(';');
    const dip = f.dip != null ? String(f.dip) : '';
    f.trace.forEach((p, i) => {
      lines.push([f.id, esc(f.label), String(i), String(p.x), String(p.y), dip, esc(cuts)].join(','));
    });
  }
  return lines.join('\n');
}
