import { describe, it, expect } from 'vitest';
import { vshaleFromGR, densityPorosity, archieSw, zoneStats, aggregateZone, pickCurves, sonicPorosity, DEFAULT_PETRO } from './petrophysics';
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

describe('pickCurves: русские мнемоники и враньё в подписях единиц', () => {
  const curve = (mnemonic: string, unit: string, values: number[]) => ({ mnemonic, unit, description: '', values });
  const wellWith = (...curves: ReturnType<typeof curve>[]): Well => ({
    id: 'w', name: 'W', depth: curves[0].values.map((_, i) => 2000 + i * 0.5),
    depthUnit: 'M', lithology: [], header: {}, curves,
  });

  it('распознаёт ГК/БК (латиницей и кириллицей)', () => {
    const lat = pickCurves(wellWith(curve('GK', 'gAPI', [5]), curve('BK', 'ohm.m', [20])));
    expect(lat.gr?.mnemonic).toBe('GK');
    expect(lat.res?.mnemonic).toBe('BK');

    const cyr = pickCurves(wellWith(curve('ГК', 'мкР/ч', [5]), curve('БК', 'Ом·м', [20])));
    expect(cyr.gr?.mnemonic).toBe('ГК');
    expect(cyr.res?.mnemonic).toBe('БК');
  });

  it('предпочитает глубинный БК микробоковому МБК', () => {
    // МБК читает промытую зону — по нему Sw вышла бы заниженной.
    const p = pickCurves(wellWith(curve('MBK', 'ohm.m', [12]), curve('BK', 'ohm.m', [20])));
    expect(p.res?.mnemonic).toBe('BK');
  });

  it('берёт МБК, только если глубинного нет', () => {
    expect(pickCurves(wellWith(curve('MBK', 'ohm.m', [12]))).res?.mnemonic).toBe('MBK');
  });

  it('не принимает ГГК за ГК', () => {
    const p = pickCurves(wellWith(curve('ГГКП', 'г/см3', [2.4]), curve('ГК', 'мкР/ч', [5])));
    expect(p.gr?.mnemonic).toBe('ГК');
    expect(p.phiMethod).toBe('density'); // ГГКП ушёл в плотность
  });

  it('ОТВЕРГАЕТ «пористость», которая физически невозможна', () => {
    // Ровно случай реального НКТ: подписан m3/m3, а значения до 3.5.
    const p = pickCurves(wellWith(
      curve('GK', 'gAPI', [5]), curve('BK', 'ohm.m', [20]),
      curve('NKT', 'm3/m3', [0.6, 1.0, 1.7, 2.6, 3.5]),
    ));
    expect(p.phiMethod).not.toBe('direct'); // 166% пористости не бывает
    expect(p.phiMethod).toBe('none');       // других источников нет
  });

  it('принимает пористость, когда она правда доля', () => {
    const p = pickCurves(wellWith(
      curve('GK', 'gAPI', [5]), curve('BK', 'ohm.m', [20]),
      curve('NPHI', 'v/v', [0.05, 0.12, 0.2, 0.28]),
    ));
    expect(p.phiMethod).toBe('direct');
  });

  it('распознаёт акустику в мкс/м, даже когда подписана us/ft', () => {
    const p = pickCurves(wellWith(
      curve('GK', 'gAPI', [5]), curve('BK', 'ohm.m', [20]),
      curve('DT', 'us/ft', [230, 250, 278, 300]), // в us/ft дало бы φ>1
    ));
    expect(p.phiMethod).toBe('sonic');
    expect(p.dtRescaled).toBe(true);
  });

  it('не трогает акустику, которая действительно в us/ft', () => {
    const p = pickCurves(wellWith(
      curve('GK', 'gAPI', [5]), curve('BK', 'ohm.m', [20]),
      curve('DT', 'us/ft', [60, 75, 90, 110]),
    ));
    expect(p.dtRescaled).toBe(false);
  });
});

describe('sonicPorosity', () => {
  it('даёт правдоподобную пористость для песчаника по Уилли', () => {
    expect(sonicPorosity(90, 55.5, 189)).toBeCloseTo(0.258, 3);
    expect(sonicPorosity(55.5, 55.5, 189)).toBe(0);   // матрица → 0
    expect(sonicPorosity(40, 55.5, 189)).toBe(0);     // плотнее матрицы → 0, не отрицательная
  });
});
