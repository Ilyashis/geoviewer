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
import { lengthUnitOf, toMetres } from '../core/crs';

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
  const dataLines: string[] = [];

  let current = '';
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/); // strip BOM

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
        dataLines.push(line); // tokenised below (mode depends on WRAP)
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
  const split = (l: string) => l.split(/[\s,]+/).filter((t) => t); // space/tab/comma delimited

  if (nCols > 0) {
    if (wrap) {
      // WRAP=YES: a row spans several physical lines — flatten, then chunk by nCols.
      const toks: string[] = [];
      for (const l of dataLines) for (const t of split(l)) toks.push(t);
      for (let i = 0; i + nCols <= toks.length; i += nCols) {
        for (let c = 0; c < nCols; c++) data[c].push(Number(toks[i + c]));
      }
    } else {
      // WRAP=NO: one physical line = one depth row. Row-based parsing keeps a
      // short/garbled line from shifting every value after it; missing trailing
      // columns become NULL (NaN).
      for (const l of dataLines) {
        const toks = split(l);
        if (toks.length === 0) continue;
        for (let c = 0; c < nCols; c++) data[c].push(c < toks.length ? Number(toks[c]) : NaN);
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

  // First curve is the depth index by LAS convention. Real files come in feet;
  // normalise depth to metres (core/crs) so maps/volumetrics stay consistent.
  const depthInfo = parsed.curveInfo[0];
  const unit = lengthUnitOf(depthInfo.unit);
  const depthRaw = parsed.data[0] ?? [];
  const depth = depthRaw.map((v) => (isNull(v) ? NaN : toMetres(v, unit)));
  if (depth.length === 0) throw new Error('В секции ~ASCII нет строк данных.');

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

  /**
   * Some writers invert the line, putting the label where the value belongs:
   * `WELL.   WELL: 22R` instead of `WELL.  22R : WELL NAME`. The giveaway is a
   * value identical to its own mnemonic, in which case the description holds
   * the real content. Without this the well is named "WELL" and stops matching
   * its tops.
   */
  const headerValue = (key: string): string | undefined => {
    const item = parsed.well[key];
    if (!item) return undefined;
    const v = item.value?.trim();
    if (v && v.toUpperCase() !== key.toUpperCase()) return v;
    const d = item.description?.trim();
    return d && d.toUpperCase() !== key.toUpperCase() ? d : v || undefined;
  };

  const name = headerValue('WELL') || fileName.replace(/\.las$/i, '');

  // Surface coordinates. Projected (metric) mnemonics are tried first and as a
  // complete pair: a file carrying BOTH UTM and lat/lon must not end up with
  // easting for x and latitude for y just because of header ordering.
  const pickCoord = (re: RegExp): number | undefined => {
    for (const [k, item] of Object.entries(parsed.well)) {
      if (!re.test(k)) continue;
      const n = Number(item.value);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };
  const projX = pickCoord(/^(x|xcoord|xwell|surfx|east|easting|x_utm|xutm)$/i);
  const projY = pickCoord(/^(y|ycoord|ywell|surfy|north|northing|y_utm|yutm)$/i);
  const geoX = pickCoord(/^(lon|long|longi|slon)$/i);
  const geoY = pickCoord(/^(lat|lati|slat)$/i);

  const hasProjected = projX !== undefined && projY !== undefined;
  const hasGeographic = geoX !== undefined && geoY !== undefined;
  const x = hasProjected ? projX : hasGeographic ? geoX : undefined;
  const y = hasProjected ? projY : hasGeographic ? geoY : undefined;
  // Degrees, not metres — gridding/areas must project these before use, or a
  // field's area comes out ~10^10 times off.
  const geodetic = !hasProjected && hasGeographic ? true : undefined;

  // Depth-reference elevation above sea level, so TVDSS = TVD − kb is a true
  // subsea depth. Without it every "TVDSS" map is really TVD below each well's
  // own rig floor — and on a field whose wells sit at different elevations that
  // error is the same size as the structural relief being mapped.
  // Ordered by how explicitly each mnemonic names the *logging* datum.
  const KB_KEYS = ['EKB', 'KB', 'EDF', 'DFE', 'EREF', 'ELEV'];
  let kb: number | undefined;
  for (const key of KB_KEYS) {
    const item = parsed.well[key];
    if (!item) continue;
    const n = Number(item.value);
    if (!Number.isFinite(n)) continue;
    kb = toMetres(n, lengthUnitOf(item.unit)); // elevations come in feet too
    break;
  }

  return {
    id: `well-${uid()}`,
    name,
    uwi: headerValue('UWI') || headerValue('API') || undefined,
    x,
    y,
    geodetic,
    kb,
    depth,
    depthUnit: 'M', // normalised to metres on import (core/crs)
    curves,
    lithology: [],
    header,
  };
}
