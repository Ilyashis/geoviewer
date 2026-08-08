import { describe, it, expect } from 'vitest';
import { parseCheckshots } from './checkshot';

/** Shape of a Petrel checkshot export. Z and TWT both go negative downwards. */
const file = (rows: string, cols = ['X', 'Y', 'Z', 'TWT picked', 'MD', 'Well', 'Average velocity']) => `# Petrel checkshots format
# Unit in depth: m
VERSION 1
BEGIN HEADER
${cols.join('\n')}
END HEADER
${rows}`;

describe('parseCheckshots', () => {
  it('flips elevation and signed time into depth-positive pairs', () => {
    const cs = parseCheckshots(file(
      '328818.61 3818409.01 7.60 10.26 0.00 "100" 1481.48\n' +
      '328818.61 3818409.01 -992.40 -800.00 1000.00 "100" 2481.00',
    ));
    expect(cs).toHaveLength(1);
    expect(cs[0].well).toBe('100');
    // Z = −992.4 (elevation) → TVDSS 992.4; TWT −800 → 800 ms.
    expect(cs[0].points[1].tvdss).toBeCloseTo(992.4, 6);
    expect(cs[0].points[1].twt).toBeCloseTo(800, 6);
  });

  it('agrees with the file\'s own average velocity (|TWT| = 2·|Z|/Vavg)', () => {
    // The cross-check that established the sign convention in the first place.
    const cs = parseCheckshots(file(
      '1 2 0 0 0 "W" 0\n' +
      '1 2 -2117.40 -1612.88 2125.00 "W" 2625.61',
    ));
    const p = cs[0].points[1];
    expect((2000 * p.tvdss) / p.twt).toBeCloseTo(2625.61, 0);
  });

  it('splits rows by well and sorts each by depth', () => {
    const cs = parseCheckshots(file(
      '1 2 -500 -400 500 "B" 2500\n' +
      '1 2 -100 -80 100 "A" 2500\n' +
      '1 2 -1300 -1000 1300 "B" 2600\n' +
      '1 2 -900 -700 900 "A" 2571',
    ));
    expect(cs.map((w) => w.well).sort()).toEqual(['A', 'B'].sort());
    const a = cs.find((w) => w.well === 'A')!;
    expect(a.points.map((p) => p.tvdss)).toEqual([100, 900]);
  });

  it('reads column order from the header instead of assuming it', () => {
    const cs = parseCheckshots(file(
      '"W" 0 0 0\n"W" 1000.00 -700 -900\n',
      ['Well', 'MD', 'TWT picked', 'Z'],
    ));
    expect(cs[0].points[1].tvdss).toBeCloseTo(900, 6);
    expect(cs[0].points[1].twt).toBeCloseTo(700, 6);
  });

  it('drops -999 nulls rather than treating them as data', () => {
    const cs = parseCheckshots(file(
      '1 2 -100 -80 100 "A" 2500\n' +
      '1 2 -999 -999 200 "A" -999\n' +
      '1 2 -300 -240 300 "A" 2500',
    ));
    expect(cs[0].points.map((p) => p.tvdss)).toEqual([100, 300]);
  });

  it('drops a well with a single usable point (no relation to interpolate)', () => {
    expect(parseCheckshots(file('1 2 -100 -80 100 "A" 2500'))).toEqual([]);
  });

  it('rejects a file that is not the checkshot format', () => {
    expect(() => parseCheckshots('Well,MD\nA,100')).toThrow(/BEGIN HEADER/);
  });
});
