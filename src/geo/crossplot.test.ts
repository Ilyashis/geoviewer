import { describe, it, expect } from 'vitest';
import { collectSamples, curveMnemonics, pearson, histogram } from './crossplot';
import type { Well, Marker } from '../types';

function well(id: string, depth: number[], gr: (number | null)[], rhob: (number | null)[]): Well {
  return {
    id, name: id, depth, depthUnit: 'M', lithology: [], header: {},
    curves: [
      { mnemonic: 'GR', unit: 'GAPI', description: '', values: gr },
      { mnemonic: 'RHOB', unit: 'G/C3', description: '', values: rhob },
    ],
  };
}

const w1 = well('a', [2000, 2001, 2002], [40, 80, 120], [2.3, 2.45, 2.6]);
const w2 = well('b', [2000, 2001], [50, null], [2.35, 2.5]);

describe('curveMnemonics', () => {
  it('returns the union in first-seen order', () => {
    expect(curveMnemonics([w1, w2])).toEqual(['GR', 'RHOB']);
  });
});

describe('collectSamples', () => {
  it('aligns X/Y, skips nulls, colours by depth when zMnem is null', () => {
    const s = collectSamples([w1, w2], 'GR', 'RHOB', null);
    expect(s).toHaveLength(4); // 3 from w1 + 1 from w2 (the null GR row is dropped)
    expect(s[0]).toEqual({ x: 40, y: 2.3, z: 2000, wellId: 'a' });
  });

  it('colours by a third curve when given', () => {
    const s = collectSamples([w1], 'RHOB', 'GR', 'GR', null);
    expect(s[1].z).toBe(80);
  });

  it('restricts to a zone between two markers', () => {
    const top: Marker = { id: 't', label: 'Top', color: '#000', depths: { a: 2001 } };
    const base: Marker = { id: 'b', label: 'Base', color: '#000', depths: { a: 2002 } };
    const s = collectSamples([w1], 'GR', 'RHOB', null, { top, base });
    expect(s.map((p) => p.x)).toEqual([80, 120]); // only 2001 and 2002
  });
});

describe('pearson', () => {
  it('is +1 for a perfectly increasing relation', () => {
    const s = collectSamples([w1], 'GR', 'RHOB', null); // GR and RHOB both increase
    expect(pearson(s)).toBeCloseTo(1, 6);
  });
  it('honours a log axis', () => {
    const lw = well('l', [1, 2, 3], [1, 10, 100], [1, 2, 3]);
    const s = collectSamples([lw], 'GR', 'RHOB', null);
    expect(pearson(s, true, false)).toBeCloseTo(1, 6); // log10(GR) linear vs RHOB
  });
});

describe('histogram', () => {
  it('bins finite values', () => {
    const h = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(h.bins).toHaveLength(5);
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(10);
    expect(h.max).toBeGreaterThan(0);
  });
});
