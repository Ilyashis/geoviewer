import { describe, it, expect } from 'vitest';
import { parseSegy, ibmToFloat, type SegyFormat } from './segy';

/**
 * Minimal SEG-Y encoder, written for the tests so the reader can be checked
 * against real bytes rather than against itself. Big-endian throughout.
 */
function buildSegy(opts: {
  ns: number;
  dt: number;
  format: SegyFormat;
  traces: { samples: number[]; x?: number; y?: number; scalco?: number; cdp?: number; inline?: number; crossline?: number }[];
  ascii?: boolean;
  textLine?: string;
}): ArrayBuffer {
  const bytesPer: Record<number, number> = { 1: 4, 2: 4, 3: 2, 5: 4, 8: 1 };
  const sb = bytesPer[opts.format];
  const traceBytes = 240 + opts.ns * sb;
  const buf = new ArrayBuffer(3200 + 400 + opts.traces.length * traceBytes);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // --- textual header ---
  const line = (opts.textLine ?? 'C 1 TEST LINE').padEnd(80, ' ');
  if (opts.ascii) {
    for (let i = 0; i < 3200; i++) u8[i] = i < line.length ? line.charCodeAt(i) : 0x20;
  } else {
    // ASCII → EBCDIC for the few characters used here.
    const toEbcdic = (c: string): number => {
      const code = c.charCodeAt(0);
      if (c === ' ') return 0x40;
      if (c >= 'A' && c <= 'I') return 0xc1 + (code - 65);
      if (c >= 'J' && c <= 'R') return 0xd1 + (code - 74);
      if (c >= 'S' && c <= 'Z') return 0xe2 + (code - 83);
      if (c >= '0' && c <= '9') return 0xf0 + (code - 48);
      return 0x40;
    };
    for (let i = 0; i < 3200; i++) u8[i] = i < line.length ? toEbcdic(line[i]) : 0x40;
  }

  // --- binary header (1-indexed positions quoted) ---
  v.setUint16(3200 + 16, opts.dt);      // 3217
  v.setUint16(3200 + 20, opts.ns);      // 3221
  v.setUint16(3200 + 24, opts.format);  // 3225

  // --- traces ---
  opts.traces.forEach((t, i) => {
    const h = 3600 + i * traceBytes;
    v.setInt32(h + 20, t.cdp ?? i + 1);            // 21–24
    v.setInt16(h + 70, t.scalco ?? 1);             // 71–72
    v.setInt32(h + 188, t.inline ?? 0);            // 189–192
    v.setInt32(h + 192, t.crossline ?? 0);         // 193–196
    v.setInt32(h + 180, t.x ?? 0);                 // 181–184 CDP-X
    v.setInt32(h + 184, t.y ?? 0);                 // 185–188 CDP-Y
    t.samples.forEach((s, k) => {
      const o = h + 240 + k * sb;
      if (opts.format === 5) v.setFloat32(o, s);
      else if (opts.format === 2) v.setInt32(o, s);
      else if (opts.format === 3) v.setInt16(o, s);
      else if (opts.format === 8) v.setInt8(o, s);
      else v.setUint32(o, floatToIbm(s)); // format 1
    });
  });
  return buf;
}

/** IEEE → IBM float, the inverse of the reader's conversion. */
function floatToIbm(x: number): number {
  if (x === 0) return 0;
  const sign = x < 0 ? 1 : 0;
  let a = Math.abs(x);
  let exp = 0;
  while (a >= 1) { a /= 16; exp++; }
  while (a < 1 / 16) { a *= 16; exp--; }
  const fraction = Math.round(a * Math.pow(2, 24));
  return ((sign << 31) | ((exp + 64) << 24) | (fraction & 0x00ffffff)) >>> 0;
}

describe('ibmToFloat', () => {
  it('decodes the canonical IBM bit patterns', () => {
    // Published reference values for the IBM System/360 format.
    expect(ibmToFloat(0x00000000)).toBe(0);
    expect(ibmToFloat(0x41100000)).toBeCloseTo(1, 9);      // 0.0625 × 16^1
    expect(ibmToFloat(0xc1100000)).toBeCloseTo(-1, 9);
    expect(ibmToFloat(0x42640000)).toBeCloseTo(100, 9);    // 0.390625 × 16^2
    expect(ibmToFloat(0x41200000)).toBeCloseTo(2, 9);
  });

  it('treats a zero fraction as zero whatever the exponent', () => {
    expect(ibmToFloat(0x7f000000)).toBe(0);
  });
});

describe('parseSegy', () => {
  it('reads the binary header and trace samples (IEEE)', () => {
    const buf = buildSegy({
      ns: 4, dt: 2000, format: 5,
      traces: [{ samples: [1, -2, 3.5, 0] }, { samples: [0, 1, 2, 3] }],
    });
    const f = parseSegy(buf);
    expect(f.ns).toBe(4);
    expect(f.dt).toBe(2000);
    expect(f.format).toBe(5);
    expect(f.traces).toHaveLength(2);
    expect([...f.traces[0].samples]).toEqual([1, -2, 3.5, 0]);
  });

  it('round-trips IBM floats, the format most legacy files use', () => {
    const values = [1, -1, 100, 0.5, -0.0625, 1234.5];
    const f = parseSegy(buildSegy({ ns: values.length, dt: 4000, format: 1, traces: [{ samples: values }] }));
    values.forEach((v, i) => expect(f.traces[0].samples[i]).toBeCloseTo(v, 4));
  });

  it('reads 16-bit integer samples', () => {
    const f = parseSegy(buildSegy({ ns: 3, dt: 1000, format: 3, traces: [{ samples: [-32768, 0, 32767] }] }));
    expect([...f.traces[0].samples]).toEqual([-32768, 0, 32767]);
  });

  it('applies the coordinate scalar in both directions', () => {
    // Positive multiplies, negative divides — a classic source of 100× errors.
    const f = parseSegy(buildSegy({
      ns: 1, dt: 1000, format: 5,
      traces: [
        { samples: [0], x: 500000, y: 6000000, scalco: 1 },
        { samples: [0], x: 50000000, y: 600000000, scalco: -100 },
        { samples: [0], x: 5000, y: 60000, scalco: 10 },
      ],
    }));
    expect(f.traces[0].x).toBeCloseTo(500000, 6);
    expect(f.traces[1].x).toBeCloseTo(500000, 6); // divided by 100
    expect(f.traces[2].x).toBeCloseTo(50000, 6);  // multiplied by 10
  });

  it('reads coordinates from a non-standard byte position when told to', () => {
    // Written at the source-coordinate pair (73/77) instead of CDP-X/Y.
    const buf = buildSegy({ ns: 1, dt: 1000, format: 5, traces: [{ samples: [0] }] });
    const v = new DataView(buf);
    v.setInt32(3600 + 72, 111111); // byte 73
    v.setInt32(3600 + 76, 222222); // byte 77
    const f = parseSegy(buf, { xByte: 73, yByte: 77 });
    expect(f.traces[0].x).toBeCloseTo(111111, 6);
    expect(f.traces[0].y).toBeCloseTo(222222, 6);
  });

  it('decodes an EBCDIC textual header', () => {
    const f = parseSegy(buildSegy({ ns: 1, dt: 1000, format: 5, traces: [{ samples: [0] }], textLine: 'C 1 LINE 42' }));
    expect(f.text).toContain('LINE 42');
  });

  it('decodes an ASCII textual header too', () => {
    const f = parseSegy(buildSegy({ ns: 1, dt: 1000, format: 5, traces: [{ samples: [0] }], ascii: true, textLine: 'C 1 CLIENT ACME' }));
    expect(f.text).toContain('CLIENT ACME');
  });

  it('honours maxTraces so a 3D volume cannot be opened by accident', () => {
    const traces = Array.from({ length: 50 }, () => ({ samples: [0, 1] }));
    const f = parseSegy(buildSegy({ ns: 2, dt: 1000, format: 5, traces }), { maxTraces: 10 });
    expect(f.traces).toHaveLength(10);
  });

  it('keeps CDP and inline/crossline numbering', () => {
    const f = parseSegy(buildSegy({
      ns: 1, dt: 1000, format: 5,
      traces: [{ samples: [0], cdp: 7, inline: 300, crossline: 1200 }],
    }));
    expect(f.traces[0].cdp).toBe(7);
    expect(f.traces[0].inline).toBe(300);
    expect(f.traces[0].crossline).toBe(1200);
  });

  it('reads the delay recording time as t0, including negative values', () => {
    // Real 2D lines start above the seismic datum: delay is routinely negative.
    const buf = buildSegy({ ns: 4, dt: 2000, format: 5, traces: [{ samples: [0, 0, 0, 0] }] });
    new DataView(buf).setInt16(3600 + 108, -45); // byte 109
    expect(parseSegy(buf).t0).toBe(-45);
  });

  it('falls back to the source-coordinate pair when CDP-X/Y is empty', () => {
    // Writers disagree on which pair to fill; some fill only 73/77.
    const buf = buildSegy({ ns: 1, dt: 1000, format: 5, traces: [{ samples: [0] }] });
    const v = new DataView(buf);
    v.setInt32(3600 + 180, 0); v.setInt32(3600 + 184, 0);  // CDP-X/Y empty
    v.setInt32(3600 + 72, 123207); v.setInt32(3600 + 76, 1119097);
    const f = parseSegy(buf);
    expect(f.traces[0].x).toBeCloseTo(123207, 6);
    expect(f.traces[0].y).toBeCloseTo(1119097, 6);
  });

  it('prefers CDP-X/Y when both pairs are filled', () => {
    const buf = buildSegy({ ns: 1, dt: 1000, format: 5, traces: [{ samples: [0], x: 500, y: 600 }] });
    const v = new DataView(buf);
    v.setInt32(3600 + 72, 999); v.setInt32(3600 + 76, 888);
    expect(parseSegy(buf).traces[0].x).toBeCloseTo(500, 6);
  });

  it('rejects a file that is too short or has an unknown format', () => {
    expect(() => parseSegy(new ArrayBuffer(100))).toThrow(/не SEG-Y/);
    const bad = buildSegy({ ns: 1, dt: 1000, format: 5, traces: [{ samples: [0] }] });
    new DataView(bad).setUint16(3200 + 24, 9); // unsupported code
    expect(() => parseSegy(bad)).toThrow(/Неподдерживаемый формат/);
  });
});
