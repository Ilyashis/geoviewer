import type { Well } from '../types';
import { computeTrajectory } from '../wells/deviation';

function fmt(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2).padStart(12);
}

/**
 * Serialize one well's trajectory as a Petrel-style `.dev` file — the export
 * counterpart of `wells/dev.ts`'s parser, same header fields and MD/X/Y/Z
 * table it reads back. `well.x`/`well.y` must already be metric (run the set
 * through `wells/coords.metricWells` first) — a geodetic well's lon/lat would
 * print as meaningless numbers in this table.
 */
export function buildDevFile(well: Well): string {
  const x = well.x ?? 0, y = well.y ?? 0, kb = well.kb ?? 0;
  const traj = computeTrajectory(well.survey ?? []);

  type Row = { md: number; north: number; east: number; tvd: number; inc: number; azi: number };
  let rows: Row[];
  if (traj.length > 0) {
    const survey = (well.survey ?? []).filter((s) => Number.isFinite(s.md)).sort((a, b) => a.md - b.md);
    rows = traj.map((t, i) => ({ md: t.md, north: t.north, east: t.east, tvd: t.tvd, inc: survey[i]?.inc ?? 0, azi: survey[i]?.azi ?? 0 }));
  } else {
    // No survey — a vertical stub spanning the logged interval, same shape
    // parseDev itself treats as "nothing worth storing" on re-import.
    const bottom = well.depth.filter(Number.isFinite).reduce((mx, d) => Math.max(mx, d), 0);
    rows = [{ md: 0, north: 0, east: 0, tvd: 0, inc: 0, azi: 0 }];
    if (bottom > 0) rows.push({ md: bottom, north: 0, east: 0, tvd: bottom, inc: 0, azi: 0 });
  }

  const lines = [
    '# WELL TRACE FROM GEOVIEWER',
    `# WELL NAME:              ${well.name}`,
    `# WELL HEAD X-COORDINATE: ${x.toFixed(2)} (m)`,
    `# WELL HEAD Y-COORDINATE: ${y.toFixed(2)} (m)`,
    `# WELL DATUM (KB, Kelly bushing, from MSL): ${kb.toFixed(2)} (m)`,
    '# MD AND TVD ARE REFERENCED (=0) AT WELL DATUM AND INCREASE DOWNWARDS',
    '#================================================================',
    '      MD            X            Y            Z           TVD           DX          DY          AZIM         INCL         DLS',
    '#================================================================',
  ];
  for (const r of rows) {
    const px = x + r.east, py = y + r.north, pz = kb - r.tvd;
    lines.push([fmt(r.md), fmt(px), fmt(py), fmt(pz), fmt(r.tvd), fmt(r.east), fmt(r.north), fmt(r.azi), fmt(r.inc), fmt(0)].join(' '));
  }
  return lines.join('\n') + '\n';
}
