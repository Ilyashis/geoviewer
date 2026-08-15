import { describe, it, expect } from 'vitest';
import { buildSeismicHorizonsCsv } from './seismicHorizons';

describe('buildSeismicHorizonsCsv', () => {
  it('writes one row per control point, keyed by horizon label and line', () => {
    const horizons = {
      'Top A': { A: [{ x: 10, y: 20, z: 2000 }, { x: 30, y: 40, z: 2010 }] },
    };
    const rows = buildSeismicHorizonsCsv(horizons).split('\n');
    expect(rows[0]).toBe('Horizon,Line,PointIndex,X,Y,Z');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe('Top A,A,0,10,20,2000');
    expect(rows[2]).toBe('Top A,A,1,30,40,2010');
  });

  it('handles the same horizon picked on more than one line', () => {
    const horizons = {
      'Top A': {
        A: [{ x: 10, y: 20, z: 2000 }],
        B: [{ x: 15, y: 25, z: 2005 }],
      },
    };
    const rows = buildSeismicHorizonsCsv(horizons).split('\n');
    expect(rows).toHaveLength(3); // header + 1 + 1
    expect(rows.some((r) => r.startsWith('Top A,A,'))).toBe(true);
    expect(rows.some((r) => r.startsWith('Top A,B,'))).toBe(true);
  });

  it('quotes a horizon label containing a comma', () => {
    const horizons = { 'Top A, боковой': { A: [{ x: 0, y: 0, z: 0 }] } };
    const rows = buildSeismicHorizonsCsv(horizons).split('\n');
    expect(rows[1]).toContain('"Top A, боковой"');
  });

  it('is just a header line when there are no horizons', () => {
    expect(buildSeismicHorizonsCsv({})).toBe('Horizon,Line,PointIndex,X,Y,Z');
  });
});
