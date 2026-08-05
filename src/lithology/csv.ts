/**
 * Parser for a lithology-intervals CSV/TSV. Header row + columns detected
 * flexibly (RU/EN): well, top depth, base depth, lithology, and optional
 * saturation. One row = one interval.
 */

export interface LithoRow {
  well: string;
  top: number;
  base: number;
  litho: string;
  sat?: string;
}

const WELL_RE = /^(well|wellname|well name|скважина|скв|uwi|api)$/i;
const TOP_RE = /^(top|from|кровля|верх|top md|md top|от)$/i;
const BASE_RE = /^(base|bottom|to|подошва|низ|base md|md base|до)$/i;
const LITHO_RE = /(litho|lithology|rock|порода|литотип|литолог)/i;
const SAT_RE = /(satur|fluid|насыщ|флюид)/i;

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

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function findCol(headers: string[], exact: RegExp, fallback?: RegExp): number {
  let idx = headers.findIndex((h) => exact.test(h));
  if (idx === -1 && fallback) idx = headers.findIndex((h) => fallback.test(h));
  return idx;
}

const num = (s: string | undefined) => Number(s?.replace(',', '.').trim());

export interface ParsedLithology {
  rows: LithoRow[];
  columns: { well: string; top: string; base: string; litho: string; sat?: string };
}

export function parseLithologyCsv(text: string): ParsedLithology {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('Нужны строка заголовка и хотя бы одна строка данных.');

  const delim = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delim);

  const wellIdx = findCol(headers, WELL_RE, /well|скважин|uwi/i);
  const topIdx = findCol(headers, TOP_RE, /top|кровл|from|верх/i);
  const baseIdx = findCol(headers, BASE_RE, /base|bottom|подошв|низ|to\b/i);
  const lithoIdx = findCol(headers, LITHO_RE);
  const satIdx = findCol(headers, SAT_RE);

  const missing: string[] = [];
  if (wellIdx === -1) missing.push('скважина (well)');
  if (topIdx === -1) missing.push('кровля (top)');
  if (baseIdx === -1) missing.push('подошва (base)');
  if (lithoIdx === -1) missing.push('литотип (lithology)');
  if (missing.length) {
    throw new Error(`Не найдены колонки: ${missing.join(', ')}. Заголовки: ${headers.join(', ')}`);
  }

  const rows: LithoRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const well = cells[wellIdx]?.trim();
    const litho = cells[lithoIdx]?.trim();
    const top = num(cells[topIdx]);
    const base = num(cells[baseIdx]);
    if (!well || !litho || !Number.isFinite(top) || !Number.isFinite(base)) continue;
    const sat = satIdx !== -1 ? cells[satIdx]?.trim() || undefined : undefined;
    rows.push({ well, top: Math.min(top, base), base: Math.max(top, base), litho, sat });
  }

  return {
    rows,
    columns: {
      well: headers[wellIdx], top: headers[topIdx], base: headers[baseIdx],
      litho: headers[lithoIdx], sat: satIdx !== -1 ? headers[satIdx] : undefined,
    },
  };
}
