/**
 * SEG-Y reader (rev 0/1), enough of it to load a 2D line.
 *
 * Layout: a 3200-byte textual header (usually EBCDIC), a 400-byte binary
 * header, then traces of a 240-byte header followed by `ns` samples. Everything
 * is BIG-endian, which is the first thing that bites when reading it in a
 * browser where little-endian is the default.
 *
 * Sample formats seen in practice are covered: IBM 32-bit float (still the most
 * common in older data), IEEE float, and the 16/32-bit integer variants.
 *
 * Real files deviate from the spec more often than they follow it — coordinates
 * written at non-standard byte offsets are routine — so byte positions that are
 * commonly relocated are exposed as options rather than hard-coded.
 */

import type { SeismicSection } from './section';
import type { TiePoint } from '../core/geom/similarity';

/** Sample format codes from the binary header (byte 3225). */
export type SegyFormat = 1 | 2 | 3 | 5 | 8;

export interface SegyTrace {
  /** Sample values in acquisition order. */
  samples: Float32Array;
  /** CDP/ensemble number, when present. */
  cdp: number;
  inline: number;
  crossline: number;
  /** Coordinates after applying the header's scalar; NaN when absent. */
  x: number;
  y: number;
}

export interface SegyFile {
  /** Decoded textual header, 40 lines of 80 characters. */
  text: string;
  format: SegyFormat;
  /** Sample interval, microseconds. */
  dt: number;
  /** Samples per trace. */
  ns: number;
  /**
   * Time of the FIRST sample, ms (the delay recording time, trace byte 109).
   * Often negative: those samples sit above the seismic datum, exactly as the
   * shallowest checkshot samples sit above mean sea level. Sample i is at
   * `t0 + i·dt/1000` ms, positive downwards.
   */
  t0: number;
  traces: SegyTrace[];
}

export interface SegyOptions {
  /** Stop after this many traces — a guard against opening a 3D volume by accident. */
  maxTraces?: number;
  /**
   * Byte position (1-indexed, within the 240-byte trace header) of the X and Y
   * coordinates. Left unset, the rev-1 CDP-X/Y pair at 181/185 is tried first
   * and the source-coordinate pair at 73/77 is used when that reads all zeros —
   * writers disagree about which pair to fill, and some fill both.
   */
  xByte?: number;
  yByte?: number;
}

const TEXT_HEADER = 3200;
const BIN_HEADER = 400;
const TRACE_HEADER = 240;

/**
 * IBM System/360 32-bit float → IEEE double.
 * sign(1) · exponent(7, base 16, excess-64) · fraction(24), value =
 * ±0.fraction × 16^(exp−64). The fraction is an integer over 2^24, and
 * 2^24 = 16^6, which folds into the exponent.
 */
export function ibmToFloat(bits: number): number {
  const fraction = bits & 0x00ffffff;
  if (fraction === 0) return 0;
  const sign = bits >>> 31 ? -1 : 1;
  const exponent = (bits >>> 24) & 0x7f;
  return sign * fraction * Math.pow(16, exponent - 64 - 6);
}

/** EBCDIC (cp037) → ASCII for the printable range; anything else becomes a space. */
const EBCDIC = buildEbcdicTable();
function buildEbcdicTable(): string[] {
  const t = new Array<string>(256).fill(' ');
  const put = (start: number, chars: string) => {
    for (let i = 0; i < chars.length; i++) t[start + i] = chars[i];
  };
  put(0x81, 'abcdefghi');
  put(0x91, 'jklmnopqr');
  put(0xa2, 'stuvwxyz');
  put(0xc1, 'ABCDEFGHI');
  put(0xd1, 'JKLMNOPQR');
  put(0xe2, 'STUVWXYZ');
  put(0xf0, '0123456789');
  t[0x40] = ' '; t[0x4b] = '.'; t[0x4c] = '<'; t[0x4d] = '('; t[0x4e] = '+';
  t[0x50] = '&'; t[0x5a] = '!'; t[0x5b] = '$'; t[0x5c] = '*'; t[0x5d] = ')';
  t[0x5e] = ';'; t[0x60] = '-'; t[0x61] = '/'; t[0x6b] = ','; t[0x6c] = '%';
  t[0x6d] = '_'; t[0x6e] = '>'; t[0x6f] = '?'; t[0x7a] = ':'; t[0x7d] = "'";
  t[0x7e] = '='; t[0x7f] = '"';
  return t;
}

/**
 * Decode the textual header. Files are meant to be EBCDIC but ASCII ones are
 * common, so the encoding is detected from the content rather than assumed.
 *
 * The two interpretations are scored against each other by how many letters
 * each yields, instead of testing one against a density threshold: a header
 * that is mostly blank — legal, and not unusual — has few letters under any
 * reading, so an absolute threshold misclassifies it.
 */
function decodeTextHeader(bytes: Uint8Array): string {
  const inRange = (b: number, lo: number, hi: number) => b >= lo && b <= hi;
  let asciiLetters = 0, ebcdicLetters = 0;
  for (const b of bytes) {
    if (inRange(b, 65, 90) || inRange(b, 97, 122)) asciiLetters++;
    if (inRange(b, 0x81, 0x89) || inRange(b, 0x91, 0x99) || inRange(b, 0xa2, 0xa9)
      || inRange(b, 0xc1, 0xc9) || inRange(b, 0xd1, 0xd9) || inRange(b, 0xe2, 0xe9)) ebcdicLetters++;
  }
  const useAscii = asciiLetters > ebcdicLetters;

  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += useAscii ? (b >= 32 && b < 127 ? String.fromCharCode(b) : ' ') : EBCDIC[b];
    if ((i + 1) % 80 === 0) out += '\n';
  }
  return out.trimEnd();
}

function readSamples(view: DataView, offset: number, ns: number, format: SegyFormat): Float32Array {
  const out = new Float32Array(ns);
  switch (format) {
    case 1: for (let i = 0; i < ns; i++) out[i] = ibmToFloat(view.getUint32(offset + i * 4)); break;
    case 5: for (let i = 0; i < ns; i++) out[i] = view.getFloat32(offset + i * 4); break;
    case 2: for (let i = 0; i < ns; i++) out[i] = view.getInt32(offset + i * 4); break;
    case 3: for (let i = 0; i < ns; i++) out[i] = view.getInt16(offset + i * 2); break;
    case 8: for (let i = 0; i < ns; i++) out[i] = view.getInt8(offset + i); break;
  }
  return out;
}

const BYTES_PER_SAMPLE: Record<SegyFormat, number> = { 1: 4, 2: 4, 3: 2, 5: 4, 8: 1 };

export function parseSegy(buffer: ArrayBuffer, opts: SegyOptions = {}): SegyFile {
  if (buffer.byteLength < TEXT_HEADER + BIN_HEADER) {
    throw new Error('Файл короче заголовков SEG-Y — это не SEG-Y.');
  }
  const view = new DataView(buffer);
  const text = decodeTextHeader(new Uint8Array(buffer, 0, TEXT_HEADER));

  // Binary header fields are quoted by their 1-indexed position in the file.
  const dt = view.getUint16(TEXT_HEADER + 16);        // 3217–3218
  const ns = view.getUint16(TEXT_HEADER + 20);        // 3221–3222
  const format = view.getUint16(TEXT_HEADER + 24) as SegyFormat; // 3225–3226

  if (!BYTES_PER_SAMPLE[format]) {
    throw new Error(`Неподдерживаемый формат отсчётов SEG-Y: ${format}. Поддержаны 1 (IBM), 2, 3, 5 (IEEE), 8.`);
  }
  if (!(ns > 0)) throw new Error('В бинарном заголовке не указано число отсчётов на трассу.');

  const sampleBytes = BYTES_PER_SAMPLE[format];
  const traceBytes = TRACE_HEADER + ns * sampleBytes;
  const dataStart = TEXT_HEADER + BIN_HEADER;
  const available = Math.floor((buffer.byteLength - dataStart) / traceBytes);
  const count = Math.min(available, opts.maxTraces ?? available);

  // Pick the coordinate pair by looking at the data rather than trusting one
  // convention: sample a few traces and take the pair that is actually filled.
  const filled = (xb: number, yb: number) => {
    const probes = Math.min(count, 8);
    for (let t = 0; t < probes; t++) {
      const h = dataStart + t * traceBytes;
      if (view.getInt32(h + xb - 1) !== 0 || view.getInt32(h + yb - 1) !== 0) return true;
    }
    return false;
  };
  const explicit = opts.xByte !== undefined && opts.yByte !== undefined;
  const useCdpPair = explicit ? false : filled(181, 185);
  const xByte = opts.xByte ?? (useCdpPair ? 181 : 73);
  const yByte = opts.yByte ?? (useCdpPair ? 185 : 77);

  const traces: SegyTrace[] = [];
  for (let t = 0; t < count; t++) {
    const h = dataStart + t * traceBytes;
    // Coordinate scalar (byte 71): positive multiplies, negative divides.
    const scalco = view.getInt16(h + 70);
    const scale = scalco > 0 ? scalco : scalco < 0 ? 1 / -scalco : 1;
    const rawX = view.getInt32(h + xByte - 1);
    const rawY = view.getInt32(h + yByte - 1);

    traces.push({
      samples: readSamples(view, h + TRACE_HEADER, ns, format),
      cdp: view.getInt32(h + 20),        // 21–24
      inline: view.getInt32(h + 188),    // 189–192
      crossline: view.getInt32(h + 192), // 193–196
      x: rawX === 0 ? NaN : rawX * scale,
      y: rawY === 0 ? NaN : rawY * scale,
    });
  }

  // Delay recording time of the first sample (trace byte 109), milliseconds.
  const t0 = count > 0 ? view.getInt16(dataStart + 108) : 0;

  return { text, format, dt, ns, t0, traces };
}

/** An imported line, ready for the viewer. */
export interface SegyLine {
  id: string;
  /** Short label — the survey name from the textual header, else the file name. */
  label: string;
  section: SeismicSection;
  /** Trace coordinates as recorded. NOT necessarily the project's CRS. */
  coords: { x: number; y: number }[];
  /** Full textual header, kept so the user can inspect provenance. */
  text: string;
  traceCount: number;
  /**
   * Manual georeferencing (`core/geom/similarity.ts`) — two points the
   * interpreter has independently confirmed the real position of. Nothing in
   * the file can substitute for this when the header has no CRS at all; it's
   * a standing gap this line's `coords` carry, not something to guess at.
   */
  tie?: [TiePoint, TiePoint];
}

/**
 * Convert a parsed SEG-Y into the section raster the viewer already renders,
 * so imported data goes through exactly the same path as the synthetic one —
 * autotracking, manual node editing and depth conversion all come for free.
 */
export function segyToSection(f: SegyFile): SeismicSection {
  const nTraces = f.traces.length;
  const nSamples = f.ns;
  const amp = new Float32Array(nTraces * nSamples);
  let ampMax = 0;
  for (let t = 0; t < nTraces; t++) {
    const s = f.traces[t].samples;
    amp.set(s, t * nSamples);
    for (let i = 0; i < s.length; i++) {
      const a = Math.abs(s[i]);
      if (a > ampMax) ampMax = a;
    }
  }
  return { nTraces, nSamples, dt: f.dt / 1000, t0: f.t0, amp, ampMax: ampMax || 1 };
}

/**
 * Survey name from the Petrel-style textual header (`C 2 Name: 30389-07_0 …`),
 * falling back to the file name. Only the name is taken, not the trailing
 * processing notes, so the selector stays readable.
 */
export function segyLabel(text: string, fileName: string): string {
  const m = text.match(/^\s*C\s*\d+\s*Name:\s*(\S+)/im);
  return m ? m[1] : fileName.replace(/\.se?g?y$/i, '');
}

/** Parse a file straight into a viewer-ready line. */
export function segyToLine(buffer: ArrayBuffer, fileName: string, opts: SegyOptions = {}): SegyLine {
  const f = parseSegy(buffer, opts);
  return {
    id: `segy-${fileName}-${f.traces.length}`,
    label: segyLabel(f.text, fileName),
    section: segyToSection(f),
    coords: f.traces.map((t) => ({ x: t.x, y: t.y })),
    text: f.text,
    traceCount: f.traces.length,
  };
}
