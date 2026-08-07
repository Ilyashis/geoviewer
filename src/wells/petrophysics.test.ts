import { describe, it, expect } from 'vitest';
import { vshaleFromGR, densityPorosity, archieSw, zoneStats, aggregateZone, DEFAULT_PETRO } from './petrophysics';
import type { Well } from '../types';

describe('petrophysics primitives', () => {
  it('linear GR shale index', () => {
    expect(vshaleFromGR(20, 20, 120)).toBe(0);
    expect(vshaleFromGR(120, 20, 120)).toBe(1);
    expect(vshaleFromGR(70, 20, 120)).toBeCloseTo(0.5, 6);
  });
  it('density porosity', () => {
    expect(densityPorosity(2.65, 2.65, 1.0)).toBe(0);
    expect(densityPorosity(2.4, 2.65, 1.0)).toBeCloseTo(0.1515, 3);
  });
  it('archie Sw = 1 when clean brine, lower at high resistivity', () => {
    const wet = archieSw(0.25, 1, { ...DEFAULT_PETRO, rw: 0.0625 });   // Sw=((0.0625)/(0.0625·1))^.5=1
    expect(wet).toBeCloseTo(1, 3);
    expect(archieSw(0.25, 50, DEFAULT_PETRO)).toBeLessThan(wet);
  });
});

function well(): Well {
  // 10 samples 2000..2004.5 step 0.5. Sand (low GR, low RHOB, high RES) at 2000..2001.5,
  // shale (high GR) below.
  const depth: number[] = [], gr: number[] = [], rhob: number[] = [], res: number[] = [];
  for (let k = 0; k < 10; k++) {
    depth.push(2000 + k * 0.5);
    const sand = k < 4;
    gr.push(sand ? 30 : 110);
    rhob.push(sand ? 2.35 : 2.55);
    res.push(sand ? 40 : 2);
  }
  return {
    id: 'w', name: 'W', depth, depthUnit: 'M', lithology: [], header: {},
    curves: [
      { mnemonic: 'GR', unit: 'GAPI', description: '', values: gr },
      { mnemonic: 'RHOB', unit: 'G/C3', description: '', values: rhob },
      { mnemonic: 'RESD', unit: 'OHMM', description: '', values: res },
    ],
  };
}

describe('zoneStats', () => {
  it('flags the sand as net pay and averages φ/Sw over it', () => {
    const s = zoneStats(well(), 2000, 2004.5, DEFAULT_PETRO)!;
    expect(s.gross).toBeCloseTo(5, 6);          // 10 samples × 0.5
    expect(s.net).toBeCloseTo(2, 6);            // 4 sand samples × 0.5
    expect(s.ng).toBeCloseTo(0.4, 6);
    expect(s.phi).toBeGreaterThan(0.1);
    expect(s.sw).toBeLessThan(0.5);
    expect(s.netSamples).toBe(4);
  });

  it('returns null when curves are missing', () => {
    const w = well(); w.curves = w.curves.filter((c) => c.mnemonic !== 'RHOB');
    expect(zoneStats(w, 2000, 2004.5, DEFAULT_PETRO)).toBeNull();
  });
});

describe('aggregateZone', () => {
  it('aggregates N/G and net-weights φ/Sw across wells', () => {
    const w1 = well(), w2 = { ...well(), id: 'w2', name: 'W2' };
    const agg = aggregateZone([w1, w2], () => 2000, () => 2004.5, DEFAULT_PETRO)!;
    expect(agg.wellsUsed).toBe(2);
    expect(agg.ng).toBeCloseTo(0.4, 6);
    expect(agg.phi).toBeGreaterThan(0.1);
  });
});
