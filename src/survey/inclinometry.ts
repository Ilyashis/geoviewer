/**
 * Parser for Russian inclinometry tables as they actually leave drilling
 * software — a different animal from the tidy one-header-row CSV that
 * `parseSurveyCsv` expects.
 *
 * Two real exports drove the design, and between them they break every
 * assumption a simple header parser makes:
 *
 *   СВОД (multi-well summary)   the header is spread over five rows, a second
 *                               unrelated legend is written into the same rows
 *                               a few columns to the left, the well column has
 *                               no title at all, and a row of column numbers
 *                               sits between header and data.
 *   MWD report (single well)    eighteen rows of metadata first, the well name
 *                               only in that metadata, and three azimuth
 *                               columns — true, magnetic and grid — which
 *                               differ here by 21°.
 *
 * The common shape is: a header whose words are stacked vertically across
 * several rows, and columns identified by meaning rather than position. So the
 * header cells are joined per column, roles are matched on the joined text, and
 * the number of rows to join is chosen by trying each depth and keeping the one
 * that resolves the most roles without any column claiming two of them. That
 * self-tuning matters: the summary needs five rows to reach "Глубина", while
 * the MWD report has "Азимут Вертикальной Секции" sitting seventeen rows up,
 * which would collide with "Зенитный угол" in the same column if joined too far.
 */

import { detectDelimiter, num, splitLine } from '../util/csv';
import { parseSurveyCsv, type SurveyRow } from './csv';

/** Which azimuth the table was read from — they differ by the declination. */
export type AzimuthKind = 'истинный' | 'картографический' | 'магнитный' | 'без уточнения';

export interface ParsedInclinometry {
  rows: SurveyRow[];
  wells: number;
  azimuth: AzimuthKind;
  /**
   * Wells whose MD restarts partway down — the file holds more than one survey
   * run for them. Worth reporting: merging the runs by depth mixes two
   * trajectories, and only the operator knows which run supersedes the other.
   */
  resurveyed: string[];
  /** Joined header text of the columns that were used, for the import report. */
  columns: { well: string; md: string; inc: string; azi: string };
  /** Depth reference elevation, when a metadata line names it explicitly. */
  kb?: number;
}

/** How far to look for the start of the data, and how many header rows to join. */
const SCAN_ROWS = 60;
const STACK_MAX = 8;

/** Cells that spell out "no reading" rather than leaving the field blank. */
const MISSING = /^(-{1,2}|—|–|н\/?д|нд)$/i;

/**
 * Up to this inclination, a blank azimuth is how a survey says "vertical here"
 * rather than a defect: the summary export writes `-` for the direction of
 * 2 700 stations, and never once above 3.5° of inclination. Above the
 * threshold a missing azimuth is a real gap and the station is dropped.
 */
const VERTICAL_INC = 5;

/**
 * A well needs a second station to describe a trajectory at all. This also
 * drops the row of column numbers that some exports place between the header
 * and the data, which otherwise reads as a one-station well.
 */
const MIN_STATIONS = 2;

/** Impossible cell value, so the first row always opens a new block. */
const SENTINEL = '\u0000';

/** A number, possibly with a decimal comma and a trailing separator (`1,`). */
const NUMERIC = /^[-+]?\d+(?:[.,]\d*)?$/;

const ROLE = {
  md: /глубин|depth|\bmd\b/i,
  inc: /зенит|наклон|инклин|inclin/i,
  azi: /азимут|дирекц|azim/i,
};

/**
 * Depth columns that are not measured depth. "Ист. Глубина" is TVD and
 * "Абс. Глубина" is subsea — both sit next to MD in the summary export, and
 * picking either would silently turn a deviated well into a vertical one.
 */
const NOT_MD = /абс|отметк|верт|tvd|ист[. ]/i;

const WELL_NAME = /скважин|№\s*скв|\bwell\b|\buwi\b/i;

/** Does this look like an inclinometry table at all (rather than tops/litho)? */
export function isInclinometryTable(text: string): boolean {
  const head = text.split(/\r\n|\r|\n/).slice(0, SCAN_ROWS).join('\n');
  return ROLE.inc.test(head) && ROLE.azi.test(head);
}

/** Trimmed cell text, with explicit "no reading" markers normalised to blank. */
function cell(v: string | undefined): string {
  const t = v?.trim() ?? '';
  return MISSING.test(t) ? '' : t;
}

/** A row is data once most of its filled cells are plain numbers. */
function isDataRow(cells: string[]): boolean {
  const filled = cells.filter((c) => c);
  if (filled.length < 4) return false;
  return filled.filter((c) => NUMERIC.test(c)).length >= filled.length * 0.6;
}

/** Join the header cells of each column across `rows`, top to bottom. */
function joinHeader(rows: string[][], width: number): string[] {
  const out: string[] = [];
  for (let c = 0; c < width; c++) {
    out.push(rows.map((r) => (r[c] ?? '').trim()).filter(Boolean).join(' '));
  }
  return out;
}

interface Roles { md: number; inc: number; azi: number; azimuth: AzimuthKind }

/**
 * How specific an azimuth column is. Magnetic and true differ by the local
 * declination — 21° in the MWD report, 11° in the summary — so taking whichever
 * column happens to come first would rotate the whole trajectory.
 */
function azimuthRank(name: string): { rank: number; kind: AzimuthKind } {
  if (/ист/i.test(name)) return { rank: 0, kind: 'истинный' };
  if (/картограф|grid/i.test(name)) return { rank: 1, kind: 'картографический' };
  if (/магнит/i.test(name)) return { rank: 2, kind: 'магнитный' };
  return { rank: 3, kind: 'без уточнения' };
}

function resolveRoles(head: string[]): Roles {
  const md = head.findIndex((h) => h && ROLE.md.test(h) && !NOT_MD.test(h));
  const inc = head.findIndex((h) => h && ROLE.inc.test(h));

  let azi = -1;
  let azimuth: AzimuthKind = 'без уточнения';
  let best = Infinity;
  for (let c = 0; c < head.length; c++) {
    if (!head[c] || !ROLE.azi.test(head[c]) || ROLE.inc.test(head[c])) continue;
    const { rank, kind } = azimuthRank(head[c]);
    if (rank < best) { best = rank; azi = c; azimuth = kind; }
  }

  return { md, inc, azi, azimuth };
}

/** Columns claiming two different roles — the sign that we joined too many rows. */
function conflicts(head: string[]): number {
  let n = 0;
  for (const h of head) {
    if (!h) continue;
    const hits = [ROLE.md.test(h) && !NOT_MD.test(h), ROLE.inc.test(h), ROLE.azi.test(h)].filter(Boolean).length;
    if (hits > 1) n++;
  }
  return n;
}

/**
 * Find the well column when nothing names it. A well identifier repeats over a
 * contiguous block of rows and never comes back later, and MD only grows inside
 * that block — which no measurement column does.
 */
function detectWellColumn(data: string[][], mdIdx: number, taken: Set<number>, width: number): number {
  for (let c = 0; c < width; c++) {
    if (taken.has(c)) continue;

    const vals = data.map((r) => cell(r[c]));
    if (vals.filter(Boolean).length < data.length * 0.8) continue;
    // A value with a fractional part is a measurement, not a well name. Without
    // this a near-constant column (magnetic azimuth in the MWD report) passes.
    if (vals.some((v) => /^[-+]?\d+[.,]\d+$/.test(v))) continue;

    const seen = new Set<string>();
    let blocks = 0, prev = SENTINEL, lastMd = -Infinity, back = 0, ok = true;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] !== prev) {
        if (seen.has(vals[i])) { ok = false; break; } // reappears → not a well
        seen.add(vals[i]);
        blocks++; prev = vals[i]; lastMd = -Infinity;
      }
      const md = num(data[i][mdIdx]);
      if (Number.isFinite(md)) {
        // MD grows along a well, but not strictly: a well surveyed more than
        // once has the runs written one after another, so restarts are normal.
        if (md < lastMd - 1e-6) back++;
        lastMd = md;
      }
    }

    // A well carries more than one station; a per-row value would give blocks ≈ rows.
    // One restart is a re-survey and must not disqualify the column; a column
    // of measurements would restart on most rows.
    if (ok && blocks > 0 && data.length / blocks >= 2 && back <= Math.max(1, data.length * 0.05)) return c;
  }
  return -1;
}

/** Well name from a labelled metadata cell, e.g. `Скважина: | 6120`. */
function wellFromMetadata(rows: string[][]): string | undefined {
  for (const r of rows) {
    for (let c = 0; c < r.length; c++) {
      if (!/^\s*(скважина|well)\s*:?\s*$/i.test(r[c] ?? '')) continue;
      const v = r.slice(c + 1).find((x) => x.trim());
      if (v) return v.trim();
    }
  }
  return undefined;
}

/**
 * Depth reference elevation from the metadata. Deliberately narrow: the MWD
 * report also carries "Альтитуда морского дна/земли", which is the ground, not
 * the datum depths are measured from.
 */
function kbFromMetadata(rows: string[][]): number | undefined {
  for (const r of rows) {
    for (let c = 0; c < r.length; c++) {
      if (!/альтитуда.*(точк|отсчет|стол|ротор)|\bkb\b/i.test(r[c] ?? '')) continue;
      const v = r.slice(c + 1).find((x) => x.trim());
      const n = parseFloat((v ?? '').replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export function parseInclinometry(text: string, fallbackWell?: string): ParsedInclinometry {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const delim = detectDelimiter(lines.slice(0, SCAN_ROWS).join('\n'));
  const cells = lines.map((l) => splitLine(l, delim));

  const start = cells.findIndex((r, i) => i < SCAN_ROWS && isDataRow(r));
  if (start <= 0) throw new Error('Не найдена таблица замеров: нет строки заголовка перед числовыми данными.');

  const width = Math.max(...cells.slice(0, start + 20).map((r) => r.length));

  // Choose how many header rows to join: the fewest that resolve the most roles
  // without a column claiming two of them.
  let head: string[] = [], roles: Roles = { md: -1, inc: -1, azi: -1, azimuth: 'без уточнения' }, bestScore = -Infinity;
  for (let k = 1; k <= Math.min(STACK_MAX, start); k++) {
    const h = joinHeader(cells.slice(start - k, start), width);
    const r = resolveRoles(h);
    const found = [r.md, r.inc, r.azi].filter((i) => i >= 0).length;
    const score = found * 2 - conflicts(h);
    if (score > bestScore) { bestScore = score; head = h; roles = r; }
  }

  const missing: string[] = [];
  if (roles.md === -1) missing.push('глубина');
  if (roles.inc === -1) missing.push('зенитный угол');
  if (roles.azi === -1) missing.push('азимут');
  if (missing.length) {
    throw new Error(`Не найдены колонки: ${missing.join(', ')}. Заголовок: ${head.filter(Boolean).join(' | ')}`);
  }

  const data = cells.slice(start).filter((r) => Number.isFinite(num(r[roles.md])));
  const taken = new Set([roles.md, roles.inc, roles.azi]);

  let wellIdx = head.findIndex((h, i) => h && !taken.has(i) && WELL_NAME.test(h));
  const namedWellCol = wellIdx !== -1;
  if (wellIdx === -1) wellIdx = detectWellColumn(data, roles.md, taken, width);

  const singleWell = wellIdx === -1
    ? wellFromMetadata(cells.slice(0, start)) ?? fallbackWell
    : undefined;
  if (wellIdx === -1 && !singleWell) {
    throw new Error('Не найдена колонка скважины и имя скважины в шапке файла.');
  }

  const all: SurveyRow[] = [];
  for (const r of data) {
    const well = (wellIdx === -1 ? singleWell! : cell(r[wellIdx])) || '';
    const md = num(cell(r[roles.md]));
    let inc = num(cell(r[roles.inc]));
    let azi = num(cell(r[roles.azi]));
    if (!well || !Number.isFinite(md) || !Number.isFinite(inc)) continue;

    if (!Number.isFinite(azi)) {
      // A station with no heading has no direction to move in, so it must not
      // move sideways at all — dropping its inclination too is the only way to
      // express that. Inventing a direction instead (north, or the last one
      // seen) turns a 2° wobble over 3 km into 70 m of confident drift: checked
      // against the export's own displacement columns, zeroing here agrees to
      // 2 m where a fabricated heading is off by 73 m.
      if (inc > VERTICAL_INC) continue; // a real gap, not a vertical stem
      inc = 0;
      azi = 0;
    }

    if (md < 0 || inc < 0 || inc > 180 || azi < 0 || azi > 360) continue;
    all.push({ well, md, inc, azi });
  }

  const stations = new Map<string, number>();
  for (const r of all) stations.set(r.well, (stations.get(r.well) ?? 0) + 1);
  const rows = all.filter((r) => (stations.get(r.well) ?? 0) >= MIN_STATIONS);

  // Flag wells whose depth restarts in file order — a second survey run.
  const resurveyed = new Set<string>();
  const lastByWell = new Map<string, number>();
  for (const r of rows) {
    const prev = lastByWell.get(r.well);
    if (prev !== undefined && r.md < prev - 1e-6) resurveyed.add(r.well);
    lastByWell.set(r.well, r.md);
  }

  return {
    rows,
    wells: new Set(rows.map((r) => r.well)).size,
    azimuth: roles.azimuth,
    resurveyed: [...resurveyed],
    columns: {
      // The unnamed well column of a summary export sits under whatever legend
      // text happens to share those header rows, so reporting that text would
      // be worse than saying plainly how the column was found.
      well: wellIdx === -1
        ? `из шапки файла — ${singleWell}`
        : namedWellCol ? head[wellIdx] : `колонка ${wellIdx + 1} (без заголовка)`,
      md: head[roles.md], inc: head[roles.inc], azi: head[roles.azi],
    },
    kb: kbFromMetadata(cells.slice(0, start)),
  };
}

export interface SurveyImportResult {
  rows: SurveyRow[];
  /** What the import actually did, for the summary line. */
  note: string;
  /**
   * Depth reference elevation and the well it belongs to. The elevation sits in
   * the file's preamble, which says nothing about which well it describes, so
   * it is only attributed when the file turns out to hold exactly one — on a
   * multi-well summary the same number would be applied to all of them.
   */
  kb?: { well: string; value: number };
}

/**
 * Read a deviation survey from either shape: the plain one-header-row CSV, or
 * a Russian drilling export. The simple parser is tried first because it is
 * unambiguous when it matches; the wrapped-header reader is the fallback.
 */
export function parseSurveyAny(text: string, fileName?: string): SurveyImportResult {
  try {
    const { rows, columns } = parseSurveyCsv(text);
    if (rows.length) return { rows, note: `колонки: ${columns.md} / ${columns.inc} / ${columns.azi}` };
  } catch {
    // fall through to the Russian export reader
  }

  const fallbackWell = fileName?.replace(/\.[^.]+$/, '');
  const p = parseInclinometry(text, fallbackWell);
  const named = [...new Set(p.rows.map((r) => r.well))];
  return {
    rows: p.rows,
    note: `азимут ${p.azimuth}, скважина: ${p.columns.well}`,
    kb: p.kb !== undefined && named.length === 1 ? { well: named[0], value: p.kb } : undefined,
  };
}
