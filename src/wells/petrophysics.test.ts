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

describe('готовая интерпретация вместо пересчёта', () => {
  const curve = (mnemonic: string, unit: string, values: (number | null)[]) =>
    ({ mnemonic, unit, description: '', values });
  const wellWith = (...curves: ReturnType<typeof curve>[]): Well => ({
    id: 'w', name: 'W', depth: curves[0].values.map((_, i) => 2000 + i * 0.5),
    depthUnit: 'M', lithology: [], header: {}, curves,
  });

  // Форма реальной выгрузки: К_кол задан на весь ствол, а К_п и К_нг — только
  // внутри коллектора; единицы подписаны «%», хотя лежат доли.
  const res4 = <T,>(a: T, b: T) => [a, a, a, a, b, b, b, b, b, b];
  const interpreted = () => wellWith(
    curve('aps', 'US', res4(0.9, 0.3)),
    curve('rp', 'Ohm.M', res4(30, 3)),
    curve('kp', '%', res4<number | null>(0.25, null)),
    curve('kng', '%', res4<number | null>(0.7, null)),
    curve('kol', 'US', res4(1, 0)),
  );

  it('берёт К_п, К_нг и флаг коллектора вместо пересчёта', () => {
    const p = pickCurves(interpreted());
    expect(p.phiCurve?.mnemonic).toBe('kp');
    expect(p.phiMethod).toBe('direct');
    expect(p.swCurve?.mnemonic).toBe('kng');
    expect(p.swSource).toBe('kng');
    expect(p.netFlag?.mnemonic).toBe('kol');
    expect(p.netSource).toBe('flag');
  });

  it('считает скважину, у которой нет ни ГК, ни сырого сопротивления', () => {
    // Именно такие скважины прежде отбрасывались целиком.
    const s = zoneStats(interpreted(), 2000, 2004.5, DEFAULT_PETRO)!;
    expect(s).not.toBeNull();
    expect(s.net).toBeCloseTo(2, 6);      // 4 отсчёта коллектора × 0.5
    expect(s.phi).toBeCloseTo(0.25, 6);
    expect(s.sw).toBeCloseTo(0.3, 6);     // 1 − К_нг
  });

  it('считает gross по всему интервалу, а не только там, где есть К_п', () => {
    // К_п существует лишь внутри коллектора: привяжи к нему gross — и N/G
    // всегда выйдет ровно 1.
    const s = zoneStats(interpreted(), 2000, 2004.5, DEFAULT_PETRO)!;
    expect(s.gross).toBeCloseTo(5, 6);
    expect(s.ng).toBeCloseTo(0.4, 6);
  });

  it('не накладывает свою отсечку по φ поверх флага интерпретатора', () => {
    const w = interpreted();
    w.curves.find((c) => c.mnemonic === 'kp')!.values = res4<number | null>(0.05, null); // ниже phiCut
    const s = zoneStats(w, 2000, 2004.5, DEFAULT_PETRO)!;
    expect(s.net).toBeCloseTo(2, 6); // флаг сказал «коллектор» — значит коллектор
  });

  it('α_ПС переворачивается: единица — чистый песчаник, а не глина', () => {
    const w = interpreted();
    w.curves = w.curves.filter((c) => c.mnemonic !== 'kol'); // без флага — по отсечкам
    const p = pickCurves(w);
    expect(p.vshSource).toBe('aps');
    expect(p.netSource).toBe('cutoffs');
    // aps=0.9 ⇒ Vsh=0.1 — коллектор; aps=0.3 ⇒ Vsh=0.7 — глина.
    expect(zoneStats(w, 2000, 2004.5, DEFAULT_PETRO)!.net).toBeCloseTo(2, 6);
  });

  it('не принимает К_во за текущую водонасыщенность', () => {
    // К_во — остаточная вода; спутать её с текущей значит завысить запасы.
    const w = wellWith(
      curve('kvo', '%', res4(0.2, 0.2)),
      curve('kp', '%', res4<number | null>(0.25, null)),
      curve('GK', '', res4(5, 90)),
      curve('BK', 'ohm.m', res4(30, 3)),
    );
    const p = pickCurves(w);
    expect(p.swCurve).toBeUndefined();
    expect(p.swSource).toBe('archie');
  });

  it('предпочитает ρ_п сырому сопротивлению, но не путает его с RPCHX', () => {
    const p = pickCurves(wellWith(curve('BK', 'ohm.m', [20]), curve('rp', 'Ohm.M', [30])));
    expect(p.res?.mnemonic).toBe('rp');

    const raw = pickCurves(wellWith(curve('RPCHX', 'ohm.m', [30]), curve('BK', 'ohm.m', [20])));
    expect(raw.res?.mnemonic).toBe('BK');
  });

  it('НКТ не заслоняет К_п, даже когда стоит первым', () => {
    // НКТ подписан m3/m3, но доходит до 3.5 — это не пористость. Раньше
    // проверялся лишь первый подходящий кандидат, и К_п терялся.
    const p = pickCurves(wellWith(
      curve('NKTS', 'm3/m3', [0.6, 3.5, 2.1, 1.8]),
      curve('kp', '%', [0.24, 0.26, 0.22, 0.25]),
    ));
    expect(p.phiCurve?.mnemonic).toBe('kp');
    expect(p.phiMethod).toBe('direct');
  });
});

describe('sonicPorosity', () => {
  it('даёт правдоподобную пористость для песчаника по Уилли', () => {
    expect(sonicPorosity(90, 55.5, 189)).toBeCloseTo(0.258, 3);
    expect(sonicPorosity(55.5, 55.5, 189)).toBe(0);   // матрица → 0
    expect(sonicPorosity(40, 55.5, 189)).toBe(0);     // плотнее матрицы → 0, не отрицательная
  });
});
