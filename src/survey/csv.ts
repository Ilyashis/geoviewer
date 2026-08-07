/**
 * Parser for a deviation-survey (inclinometry) CSV/TSV.
 *
 * Expects a header row and four logical columns — well, MD, inclination,
 * azimuth — whose names are detected flexibly (RU/EN synonyms). One row = one
 * survey station.
 */

export interface SurveyRow {
  well: string;
  md: number;
  inc: number;
  azi: number;
}

const WELL_RE = /^(well|wellname|well name|скважина|скв|uwi|api)$/i;
const MD_RE = /^(md|depth|dept|глубина|глуб|"md, м"|md, м)$/i;
const MD_FALLBACK = /(md|depth|глубин)/i;
const INC_RE = /^(inc|incl|inclination|dev|deviation|dip|наклон|зенит|зенитный|угол)$/i;
const INC_FALLBACK = /(^inc|наклон|зенит|dev)/i;
const AZI_RE = /^(az|azi|azim|azimuth|азимут|дир)$/i;
const AZI_FALLBACK = /(azim|азимут)/i;

function detectDelimiter(headerLine: string): string {
  const candidates = [';', '\t', ','];
  let best = ',', bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '', inQuotes = false;
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

function findColumn(headers: string[], exact: RegExp, fallback?: RegExp): number {
  let idx = headers.findIndex((h) => exact.test(h));
  if (idx === -1 && fallback) idx = headers.findIndex((h) => fallback.test(h));
  return idx;
}

// Empty/blank ⇒ NaN (missing), not 0 — but a real "0" (surface station, vertical) is kept.
const num = (s: string | undefined) => {
  const t = s?.replace(',', '.').trim();
  return t ? Number(t) : NaN;
};

export interface ParsedSurvey {
  rows: SurveyRow[];
  columns: { well: string; md: string; inc: string; azi: string };
}

export function parseSurveyCsv(text: string): ParsedSurvey {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('Нужны строка заголовка и хотя бы одна строка данных.');

  const delim = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delim);

  const wellIdx = findColumn(headers, WELL_RE, /well|скважин|uwi/i);
  const mdIdx = findColumn(headers, MD_RE, MD_FALLBACK);
  const incIdx = findColumn(headers, INC_RE, INC_FALLBACK);
  const aziIdx = findColumn(headers, AZI_RE, AZI_FALLBACK);

  const missing: string[] = [];
  if (wellIdx === -1) missing.push('скважина (well/uwi)');
  if (mdIdx === -1) missing.push('глубина (md/depth)');
  if (incIdx === -1) missing.push('наклон (inc/зенит)');
  if (aziIdx === -1) missing.push('азимут (azi)');
  if (missing.length) {
    throw new Error(`Не найдены колонки: ${missing.join(', ')}. Заголовки: ${headers.join(', ')}`);
  }

  const rows: SurveyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const well = cells[wellIdx]?.trim();
    const md = num(cells[mdIdx]), inc = num(cells[incIdx]), azi = num(cells[aziIdx]);
    if (!well || !Number.isFinite(md) || !Number.isFinite(inc) || !Number.isFinite(azi)) continue;
    rows.push({ well, md, inc, azi });
  }

  return { rows, columns: { well: headers[wellIdx], md: headers[mdIdx], inc: headers[incIdx], azi: headers[aziIdx] } };
}
