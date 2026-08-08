/**
 * Parser for the Petrel checkshot export (`.asc`).
 *
 * A checkshot is the measured time–depth relation of a well: the ground truth
 * that ties seismic time to geological depth. It replaces a guessed velocity
 * trend with what was actually recorded.
 *
 * Layout: a comment preamble, then a `BEGIN HEADER … END HEADER` block naming
 * the columns in order, then whitespace-separated rows. Column order is read
 * from that block rather than assumed, since exports vary.
 *
 * Two conventions in these files are easy to get wrong:
 *  - `Z` is an ELEVATION (positive up, metres above MSL), so subsea depth is −Z;
 *  - `TWT picked` shares that sign — zero at sea level, positive above it,
 *    negative below — so time-below-datum is −TWT.
 *
 * Both are simply negated, NOT taken as magnitudes: the shallowest samples sit
 * ABOVE mean sea level, and folding their sign would drag them back down the
 * curve and break its monotonicity. A negative depth with a negative time is
 * the coherent reading — the sample is above the datum. Verified against the
 * file's own average-velocity column, which satisfies TWT = 2·TVDSS / Vavg.
 */

import { contentLines, num } from '../util/csv';

export interface CheckshotPoint {
  /** Subsea depth (TVDSS), metres — positive downwards, negative above MSL. */
  tvdss: number;
  /** Two-way time below the datum, ms — negative above MSL, like the depth. */
  twt: number;
  md: number;
}

export interface WellCheckshot {
  well: string;
  points: CheckshotPoint[];
}

const NULLISH = (v: number) => !Number.isFinite(v) || v === -999 || v === -999.25;

/** Column aliases: Petrel's own names plus the obvious variants. */
const COL = {
  x: /^x$/i,
  y: /^y$/i,
  z: /^z$/i,
  twt: /^(twt|twt\s*picked|two.?way|time)/i,
  md: /^md$/i,
  well: /^well/i,
};

export function parseCheckshots(text: string): WellCheckshot[] {
  const lines = contentLines(text);

  // Column names live between BEGIN HEADER and END HEADER, one per line.
  const begin = lines.findIndex((l) => /^BEGIN\s+HEADER/i.test(l));
  const end = lines.findIndex((l) => /^END\s+HEADER/i.test(l));
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error('Не найден блок BEGIN HEADER … END HEADER — это не файл чекшотов Petrel.');
  }
  const cols = lines.slice(begin + 1, end).map((l) => l.trim());
  const idx = (re: RegExp) => cols.findIndex((c) => re.test(c));
  const iZ = idx(COL.z), iTwt = idx(COL.twt), iMd = idx(COL.md), iWell = idx(COL.well);

  const missing: string[] = [];
  if (iZ === -1) missing.push('Z');
  if (iTwt === -1) missing.push('TWT');
  if (iWell === -1) missing.push('Well');
  if (missing.length) throw new Error(`В заголовке нет колонок: ${missing.join(', ')}. Есть: ${cols.join(', ')}`);

  const byWell = new Map<string, CheckshotPoint[]>();
  for (const line of lines.slice(end + 1)) {
    if (line.startsWith('#')) continue;
    // Well names are quoted; everything else is plain whitespace-separated.
    const t = line.trim().match(/"[^"]*"|\S+/g);
    if (!t || t.length <= Math.max(iZ, iTwt, iWell)) continue;

    const well = t[iWell].replace(/^"|"$/g, '').trim();
    const z = num(t[iZ]);
    const twt = num(t[iTwt]);
    if (!well || NULLISH(z) || NULLISH(twt)) continue;

    const md = iMd >= 0 ? num(t[iMd]) : NaN;
    if (!byWell.has(well)) byWell.set(well, []);
    // Z is an elevation and TWT shares its sign: negate both so downwards is
    // positive. Samples above MSL keep a negative depth and a negative time.
    byWell.get(well)!.push({ tvdss: -z, twt: -twt, md: Number.isFinite(md) ? md : NaN });
  }

  return [...byWell.entries()]
    .map(([well, points]) => ({ well, points: points.sort((a, b) => a.tvdss - b.tvdss) }))
    .filter((w) => w.points.length >= 2);
}

/**
 * One field-wide time–depth table from every well's checkshots.
 *
 * Samples are binned by depth and averaged, rather than pooled raw: wells differ in
 * sampling density by orders of magnitude here (hundreds of points against
 * ~29 000), so pooling would let the densest well outvote the rest.
 */
export function fieldVelocityTable(
  checkshots: WellCheckshot[],
  binMetres = 25,
): { z: number; twt: number }[] {
  const bins = new Map<number, { z: number; twt: number; n: number }>();
  for (const w of checkshots) {
    for (const p of w.points) {
      if (!Number.isFinite(p.tvdss) || !Number.isFinite(p.twt)) continue;
      const key = Math.round(p.tvdss / binMetres);
      const b = bins.get(key) ?? { z: 0, twt: 0, n: 0 };
      b.z += p.tvdss; b.twt += p.twt; b.n++;
      bins.set(key, b);
    }
  }
  return [...bins.values()]
    .map((b) => ({ z: b.z / b.n, twt: b.twt / b.n }))
    .sort((a, b) => a.z - b.z);
}
