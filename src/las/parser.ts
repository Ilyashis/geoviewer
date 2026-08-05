/**
 * LAS 2.0 parser.
 *
 * Handwritten on purpose: the format is small and text-based, and real-world
 * files are full of edge cases (WRAP=YES, odd whitespace, varying NULL values,
 * missing units) that we want full control over rather than fighting a library.
 *
 * Spec reference: Canadian Well Logging Society LAS 2.0.
 */

import type { Curve, Well } from '../types';
import { uid } from '../util/id';

export interface LasHeaderItem {
  mnemonic: string;
  unit: string;
  value: string;
  description: string;
}

export interface ParsedLas {
  version: Record<string, LasHeaderItem>;
  well: Record<string, LasHeaderItem>;
  curveInfo: LasHeaderItem[];
  /** Column-major data: data[curveIndex] is the array for that curve. */
  data: number[][];
  wrap: boolean;
  nullValue: number;
}


/** Parse one `MNEM.UNIT  VALUE : DESCRIPTION` line from a header section. */
export function parseHeaderLine(line: string): LasHeaderItem | null {
  const colonIdx = line.indexOf(':');
  const left = colonIdx === -1 ? line : line.slice(0, colonIdx);
  const description = colonIdx === -1 ? '' : line.slice(colonIdx + 1).trim();

  const dotIdx = left.indexOf('.');
  if (dotIdx === -1) return null;

  const mnemonic = left.slice(0, dotIdx).trim();
  if (!mnemonic) return null;

  const rest = left.slice(dotIdx + 1);
  // Unit is glued to the dot (no space); value follows after whitespace.
  const spaceIdx = rest.search(/\s/);
  let unit = '';
  let value = '';
  if (spaceIdx === -1) {
    unit = rest.trim();
  } else {
    unit = rest.slice(0, spaceIdx).trim();
    value = rest.slice(spaceIdx).trim();
  }

  return { mnemonic, unit, value, description };
}

function sectionKind(headerLine: string): string {
  // First non-space char after '~' identifies the section (V/W/C/P/O/A).
  const c = headerLine.slice(1).trim().charAt(0).toUpperCase();
  return c;
}

/** Low-level parse into raw sections and a column-major data matrix. */
export function parseLas(text: string): ParsedLas {
  const version: Record<string, LasHeaderItem> = {};
  const well: Record<string, LasHeaderItem> = {};
  const curveInfo: LasHeaderItem[] = [];
  const dataTokens: string[] = [];

  let current = '';
  const lines = text.split(/\r\n|\r|\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('~')) {
      current = sectionKind(line);
      continue;
    }

    switch (current) {
      case 'V': {
        const item = parseHeaderLine(line);
        if (item) version[item.mnemonic] = item;
        break;
      }
      case 'W': {
        const item = parseHeaderLine(line);
        if (item) well[item.mnemonic] = item;
        break;
      }
      case 'C': {
        const item = parseHeaderLine(line);
        if (item) curveInfo.push(item);
        break;
      }
      case 'A': {
        for (const tok of line.split(/\s+/)) {
          if (tok) dataTokens.push(tok);
        }
        break;
      }
      // 'P' (parameters) and 'O' (other) are ignored for the MVP.
      default:
        break;
    }
  }

  const wrap = (version['WRAP']?.value ?? 'NO').toUpperCase().startsWith('Y');
  const nullValue = Number(well['NULL']?.value ?? '-999.25');

  const nCols = curveInfo.length;
  const data: number[][] = Array.from({ length: nCols }, () => []);

  if (nCols > 0) {
    // Flatten-then-chunk handles WRAP=YES and WRAP=NO uniformly: regardless of
    // how values are split across physical lines, every logical depth row has
    // exactly nCols tokens.
    for (let i = 0; i + nCols <= dataTokens.length; i += nCols) {
      for (let c = 0; c < nCols; c++) {
        data[c].push(Number(dataTokens[i + c]));
      }
    }
  }

  return { version, well, curveInfo, data, wrap, nullValue };
}

/** Parse LAS text into a Well ready for rendering. */
export function parseLasToWell(text: string, fileName = 'well.las'): Well {
  const parsed = parseLas(text);

  if (parsed.curveInfo.length === 0) {
    throw new Error('LAS file has no ~Curve section or no curves.');
  }

  const isNull = (v: number) => !Number.isFinite(v) || v === parsed.nullValue;

  // First curve is the depth index by LAS convention.
  const depthRaw = parsed.data[0] ?? [];
  const depth = depthRaw.map((v) => (isNull(v) ? NaN : v));
  const depthInfo = parsed.curveInfo[0];

  const curves: Curve[] = [];
  for (let c = 1; c < parsed.curveInfo.length; c++) {
    const info = parsed.curveInfo[c];
    const values = (parsed.data[c] ?? []).map((v) => (isNull(v) ? null : v));
    curves.push({
      mnemonic: info.mnemonic,
      unit: info.unit,
      description: info.description,
      values,
    });
  }

  const header: Record<string, string> = {};
  for (const [k, item] of Object.entries(parsed.well)) {
    header[k] = item.value;
  }

  const name =
    parsed.well['WELL']?.value?.trim() ||
    fileName.replace(/\.las$/i, '');

  return {
    id: `well-${uid()}`,
    name,
    uwi: parsed.well['UWI']?.value || parsed.well['API']?.value || undefined,
    depth,
    depthUnit: depthInfo.unit || 'M',
    curves,
    lithology: [],
    header,
  };
}
