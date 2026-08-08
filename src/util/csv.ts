/**
 * Shared CSV/TSV helpers for the import adapters (tops, lithology, survey,
 * well heads). Real files arrive with any of `, ; tab`, quoted fields, decimal
 * commas and blank cells, so every adapter needs the same handling — keeping it
 * in one place stops the four of them drifting apart.
 */

/** Detect the most likely delimiter from the header line. */
export function detectDelimiter(headerLine: string): string {
  const candidates = [';', '\t', ','];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

/** Minimal quote-aware field splitter for one line. */
export function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Index of the first header matching `exact`, else the first matching `fallback`. */
export function findColumn(headers: string[], exact: RegExp, fallback?: RegExp): number {
  let idx = headers.findIndex((h) => exact.test(h));
  if (idx === -1 && fallback) idx = headers.findIndex((h) => fallback.test(h));
  return idx;
}

/**
 * Parse a numeric cell, tolerating a decimal comma. Empty ⇒ NaN, never 0:
 * `Number('')` is 0, which would silently turn a blank cell into a real value.
 */
export function num(raw: string | undefined): number {
  const t = raw?.replace(',', '.').trim();
  return t ? Number(t) : NaN;
}

/** Split text into non-empty lines, tolerating CRLF and a leading BOM. */
export function contentLines(text: string): string[] {
  return text.replace(/^﻿/, '').split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
}
