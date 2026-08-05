/**
 * Parser for a "tops" (stratigraphic picks) CSV/TSV.
 *
 * Expects a header row and three logical columns — well, surface, depth — whose
 * names are detected flexibly (RU/EN synonyms). One row = one pick of a surface
 * in a well at a measured depth.
 */

export interface TopRow {
  well: string;
  surface: string;
  depth: number;
}

const WELL_RE = /^(well|wellname|well name|скважина|скв|uwi|api)$/i;
const SURFACE_RE = /(surface|top|marker|horizon|strat|пласт|горизонт|кровля|разбивк|маркер)/i;
const DEPTH_RE = /^(depth|md|dept|глубина|глуб|глубина, м|md, м)$/i;
const DEPTH_FALLBACK_RE = /(depth|md|глубин)/i;

/** Detect the most likely delimiter from the header line. */
function detectDelimiter(headerLine: string): string {
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
function splitLine(line: string, delim: string): string[] {
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

function findColumn(headers: string[], exact: RegExp, fallback?: RegExp): number {
  let idx = headers.findIndex((h) => exact.test(h));
  if (idx === -1 && fallback) idx = headers.findIndex((h) => fallback.test(h));
  return idx;
}

export interface ParsedTops {
  rows: TopRow[];
  columns: { well: string; surface: string; depth: string };
}

export function parseTopsCsv(text: string): ParsedTops {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('Нужны строка заголовка и хотя бы одна строка данных.');

  const delim = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delim);

  const wellIdx = findColumn(headers, WELL_RE, /well|скважин|uwi/i);
  const surfaceIdx = findColumn(headers, SURFACE_RE);
  const depthIdx = findColumn(headers, DEPTH_RE, DEPTH_FALLBACK_RE);

  const missing: string[] = [];
  if (wellIdx === -1) missing.push('скважина (well/uwi)');
  if (surfaceIdx === -1) missing.push('пласт (surface/top)');
  if (depthIdx === -1) missing.push('глубина (depth/md)');
  if (missing.length) {
    throw new Error(`Не найдены колонки: ${missing.join(', ')}. Заголовки: ${headers.join(', ')}`);
  }

  const rows: TopRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const well = cells[wellIdx]?.trim();
    const surface = cells[surfaceIdx]?.trim();
    const depthRaw = cells[depthIdx]?.replace(',', '.').trim();
    if (!well || !surface || !depthRaw) continue; // empty depth: Number('') is 0, guard explicitly
    const depth = Number(depthRaw);
    if (!Number.isFinite(depth)) continue;
    rows.push({ well, surface, depth });
  }

  return {
    rows,
    columns: { well: headers[wellIdx], surface: headers[surfaceIdx], depth: headers[depthIdx] },
  };
}
