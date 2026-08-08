/**
 * Parser for the Petrel well-trace export (`.dev`).
 *
 * Two useful things live in one file:
 *  - the comment header carries the wellhead X/Y and the KB elevation, which
 *    the LAS export omits entirely;
 *  - the table is an explicit MD/X/Y/Z trace of the borehole.
 *
 * The trace is read as coordinates, not as angles. Petrel writes AZIM/INCL
 * columns even when it has no angle data — such files say so outright
 * ("ANGLES ARE NOT EXACT (TRACE WAS NOT IMPORTED USING ANGLES)") and fill them
 * with zeros. The XYZ columns are the trustworthy record, so inclination and
 * azimuth are derived back from them.
 */

import type { SurveyStation } from './deviation';
import { contentLines, num } from '../util/csv';

export interface ParsedDev {
  well: string;
  x?: number;
  y?: number;
  kb?: number;
  /** Derived stations; empty when the trace is a plain vertical stub. */
  survey: SurveyStation[];
  /** True when the trace actually leaves vertical. */
  deviated: boolean;
}

const DEG = 180 / Math.PI;

/** `# LABEL: value (unit)` → value, for the header comments. */
function headerNumber(lines: string[], label: RegExp): number | undefined {
  for (const l of lines) {
    if (!l.startsWith('#') || !label.test(l)) continue;
    const m = l.match(/:\s*(-?[\d.,eE+]+)/);
    if (m) {
      const v = num(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

function headerText(lines: string[], label: RegExp): string | undefined {
  for (const l of lines) {
    if (!l.startsWith('#') || !label.test(l)) continue;
    const m = l.match(/:\s*(.+?)\s*$/);
    if (m && m[1]) return m[1];
  }
  return undefined;
}

export function parseDev(text: string, fileName = 'well.dev'): ParsedDev {
  const lines = contentLines(text);

  const well = headerText(lines, /WELL\s*NAME/i) ?? fileName.replace(/\.dev$/i, '');
  const x = headerNumber(lines, /WELL\s*HEAD\s*X/i);
  const y = headerNumber(lines, /WELL\s*HEAD\s*Y/i);
  const kb = headerNumber(lines, /WELL\s*DATUM|KELLY\s*BUSHING/i);

  // Column order comes from the header row, so a different export order still works.
  const headerRow = lines.find((l) => !l.startsWith('#') && /\bMD\b/i.test(l) && /\bX\b/i.test(l));
  const cols = headerRow ? headerRow.trim().split(/\s+/).map((c) => c.toUpperCase()) : [];
  const idx = (name: string) => cols.indexOf(name);
  const iMd = idx('MD'), iX = idx('X'), iY = idx('Y'), iZ = idx('Z');

  const rows: { md: number; x: number; y: number; z: number }[] = [];
  for (const l of lines) {
    if (l.startsWith('#')) continue;
    const t = l.trim().split(/\s+/);
    if (t.length < 4 || !/^-?[\d.]/.test(t[0])) continue; // skip the column-name row
    const md = num(t[iMd >= 0 ? iMd : 0]);
    const px = num(t[iX >= 0 ? iX : 1]);
    const py = num(t[iY >= 0 ? iY : 2]);
    const pz = num(t[iZ >= 0 ? iZ : 3]);
    if (![md, px, py, pz].every(Number.isFinite)) continue;
    rows.push({ md, x: px, y: py, z: pz });
  }
  rows.sort((a, b) => a.md - b.md);

  // Derive inclination/azimuth per station from the coordinate deltas. Z is an
  // elevation (positive up), so a downward step is a decreasing Z.
  const survey: SurveyStation[] = [];
  let deviated = false;
  for (let i = 0; i < rows.length; i++) {
    if (i === 0) { survey.push({ md: rows[0].md, inc: 0, azi: 0 }); continue; }
    const a = rows[i - 1], b = rows[i];
    const dE = b.x - a.x, dN = b.y - a.y, dV = a.z - b.z; // dV > 0 going down
    const lateral = Math.hypot(dE, dN);
    const inc = Math.atan2(lateral, dV) * DEG;
    const azi = lateral > 1e-9 ? (Math.atan2(dE, dN) * DEG + 360) % 360 : survey[i - 1].azi;
    if (inc > 0.5) deviated = true;
    survey.push({ md: b.md, inc: Number.isFinite(inc) ? inc : 0, azi });
  }

  return { well, x, y, kb, survey: deviated ? survey : [], deviated };
}
