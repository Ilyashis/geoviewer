/**
 * Parser for a well-heads table: surface coordinates and the depth-reference
 * (KB) elevation, one row per well.
 *
 * Real projects keep these OUTSIDE the LAS — Petrel, for one, exports LAS with
 * no X/Y/KB at all, so without this table a whole field imports with no
 * coordinates and nothing spatial (maps, volumes, seismic lines) can work.
 */

import { contentLines, detectDelimiter, findColumn, num, splitLine } from '../util/csv';

export interface WellHeadRow {
  well: string;
  x: number;
  y: number;
  /** Depth-reference elevation above MSL; absent when the column is missing/blank. */
  kb?: number;
}

const WELL_RE = /^(well|wellname|well name|скважина|скв|uwi|api|№)$/i;
const X_RE = /^(x|x_utm|xutm|easting|east|xcoord|x, м|x \(m\)|в|восток)$/i;
const Y_RE = /^(y|y_utm|yutm|northing|north|ycoord|y, м|y \(m\)|с|север)$/i;
// "Alt" and "Elev" are common; RU sheets say альтитуда/абс.отм./ротор.
const KB_RE = /^(kb|ekb|edf|dfe|elev|elevation|altitude|alt|альтитуда|альт|абс\.?\s*отм\.?|ротор)$/i;

/**
 * Values a producer used to mean "no data". Petrel writes -999 in unused
 * columns; taking it literally would place a well 999 m below sea level.
 */
const NULLISH = new Set([-999, -999.25, -9999, -999999]);
const clean = (v: number) => (Number.isFinite(v) && !NULLISH.has(v) ? v : undefined);

export interface ParsedWellHeads {
  rows: WellHeadRow[];
  columns: { well: string; x: string; y: string; kb?: string };
}

export function parseWellHeadsCsv(text: string): ParsedWellHeads {
  const lines = contentLines(text);
  if (lines.length < 2) throw new Error('Нужны строка заголовка и хотя бы одна строка данных.');

  const delim = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delim);

  const wellIdx = findColumn(headers, WELL_RE, /well|скважин|uwi/i);
  const xIdx = findColumn(headers, X_RE, /^x/i);
  const yIdx = findColumn(headers, Y_RE, /^y/i);
  const kbIdx = findColumn(headers, KB_RE, /альтитуд|elev|kb/i);

  const missing: string[] = [];
  if (wellIdx === -1) missing.push('скважина (well)');
  if (xIdx === -1) missing.push('X');
  if (yIdx === -1) missing.push('Y');
  if (missing.length) {
    throw new Error(`Не найдены колонки: ${missing.join(', ')}. Заголовки: ${headers.join(', ')}`);
  }

  const rows: WellHeadRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const well = cells[wellIdx]?.trim();
    if (!well) continue;
    const x = clean(num(cells[xIdx]));
    const y = clean(num(cells[yIdx]));
    if (x === undefined || y === undefined) continue; // a head with no position is useless
    rows.push({ well, x, y, kb: kbIdx === -1 ? undefined : clean(num(cells[kbIdx])) });
  }

  return {
    rows,
    columns: { well: headers[wellIdx], x: headers[xIdx], y: headers[yIdx], kb: kbIdx === -1 ? undefined : headers[kbIdx] },
  };
}
