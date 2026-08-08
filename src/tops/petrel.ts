/**
 * Parser for the Petrel "Well Tops" ASCII export.
 *
 * Same shape as the checkshot export — a `BEGIN HEADER … END HEADER` block
 * naming the columns in order, then rows — but it comes in two dialects that
 * differ in every detail except that idea:
 *
 *   VERSION 2   bare column names (`X`, `MD`, `Surface Name`, `Well Name`),
 *               whitespace-separated rows, strings in double quotes.
 *   VERSION 1   names prefixed with a type (`STRING Horizon Name`,
 *               `REAL Measured Depth`), tab-separated rows, no quotes.
 *
 * Both are handled by reading the column list and mapping names to roles,
 * rather than assuming positions.
 */

import type { TopRow } from './csv';

/** Type keywords Petrel puts before a column name in the VERSION 1 dialect. */
const TYPE_PREFIX = /^(STRING|REAL|INT|INTEGER|FLOAT|DOUBLE|BOOL)\s+/i;

const ROLE = {
  well: /well/i,
  // "Surface Name" (v2) and "Horizon Name" (v1); RU exports say пласт/горизонт.
  surface: /surface|horizon|marker|пласт|горизонт|кровля/i,
  md: /^(md|measured\s*depth|depth|глубина)/i,
  x: /^x$/i,
  y: /^y$/i,
  z: /^z$/i,
};

export interface ParsedPetrelTops {
  rows: TopRow[];
  /** Wellhead coordinates carried by the file, when it has X/Y columns. */
  heads: { well: string; x: number; y: number }[];
  surfaces: number;
  wells: number;
}

/** Does this text look like a Petrel Well Tops export (rather than a plain CSV)? */
export function isPetrelTops(text: string): boolean {
  return /^\s*BEGIN\s+HEADER\s*$/im.test(text) && /well\s*tops|surface\s*name|horizon\s*name/i.test(text);
}

/** Split a data row: tab-delimited when tabs are present, else whitespace with quoted strings. */
function splitRow(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim().replace(/^"|"$/g, ''));
  return (line.match(/"[^"]*"|\S+/g) ?? []).map((s) => s.replace(/^"|"$/g, '').trim());
}

export function parsePetrelTops(text: string): ParsedPetrelTops {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);

  const begin = lines.findIndex((l) => /^\s*BEGIN\s+HEADER/i.test(l));
  const end = lines.findIndex((l) => /^\s*END\s+HEADER/i.test(l));
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error('Не найден блок BEGIN HEADER … END HEADER — это не Petrel Well Tops.');
  }

  const cols = lines
    .slice(begin + 1, end)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((c) => c.replace(TYPE_PREFIX, '').trim()); // drop the VERSION 1 type keyword

  const idx = (re: RegExp) => cols.findIndex((c) => re.test(c));
  const iWell = idx(ROLE.well), iSurf = idx(ROLE.surface), iMd = idx(ROLE.md);
  const iX = idx(ROLE.x), iY = idx(ROLE.y);

  const missing: string[] = [];
  if (iWell === -1) missing.push('скважина (Well Name)');
  if (iSurf === -1) missing.push('пласт (Surface/Horizon Name)');
  if (iMd === -1) missing.push('глубина (MD)');
  if (missing.length) {
    throw new Error(`В заголовке нет колонок: ${missing.join(', ')}. Есть: ${cols.join(', ')}`);
  }

  const rows: TopRow[] = [];
  const headByWell = new Map<string, { well: string; x: number; y: number }>();

  for (const line of lines.slice(end + 1)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const t = splitRow(line);
    if (t.length <= Math.max(iWell, iSurf, iMd)) continue;

    const well = t[iWell];
    const surface = t[iSurf];
    const depth = Number(t[iMd]?.replace(',', '.'));
    if (!well || !surface || !Number.isFinite(depth)) continue;
    rows.push({ well, surface, depth });

    // X/Y repeat per row but describe the wellhead; keep the first seen.
    if (iX >= 0 && iY >= 0 && !headByWell.has(well)) {
      const x = Number(t[iX]), y = Number(t[iY]);
      if (Number.isFinite(x) && Number.isFinite(y)) headByWell.set(well, { well, x, y });
    }
  }

  return {
    rows,
    heads: [...headByWell.values()],
    surfaces: new Set(rows.map((r) => r.surface)).size,
    wells: new Set(rows.map((r) => r.well)).size,
  };
}
