import { describe, it, expect } from 'vitest';
import type { Well } from '../types';
import {
  DEFAULT_CORRELATION, correlateAt, isConvincing, propagatePick, resample, sampleAt,
} from './correlate';

/**
 * A log shape with several distinct beds, so a match is unambiguous. Values
 * are deterministic: the same depth always gives the same reading.
 */
const shape = (d: number) =>
  40
  + 60 * Math.exp(-((d - 1990) ** 2) / 18)
  + 45 * Math.exp(-((d - 2004) ** 2) / 40)
  - 25 * Math.exp(-((d - 2012) ** 2) / 8)
  + 8 * Math.sin(d / 3.1);

/**
 * A well whose log is `shape` moved `shift` metres deeper — the same formation
 * at a different depth, which is exactly what correlating has to recover.
 * `scale`/`offset` mimic a different tool or unit; `gap` blanks an interval.
 */
function well(
  id: string,
  { shift = 0, scale = 1, offset = 0, gap, mnemonic = 'GR', flat = false }:
  { shift?: number; scale?: number; offset?: number; gap?: [number, number]; mnemonic?: string; flat?: boolean } = {},
): Well {
  const depth: number[] = [];
  const values: (number | null)[] = [];
  for (let d = 1800; d <= 2200; d += 0.1) {
    const md = Math.round(d * 10) / 10;
    depth.push(md);
    if (gap && md >= gap[0] && md <= gap[1]) { values.push(null); continue; }
    values.push(flat ? 50 : offset + scale * shape(md - shift));
  }
  return {
    id, name: id, depth, depthUnit: 'M', lithology: [], header: {},
    curves: [{ mnemonic, unit: 'GAPI', description: '', values }],
  };
}

describe('sampleAt', () => {
  const depth = [100, 101, 102];
  it('интерполирует между отсчётами', () => {
    expect(sampleAt(depth, [10, 20, 30], 101.5)).toBeCloseTo(25, 9);
    expect(sampleAt(depth, [10, 20, 30], 100)).toBeCloseTo(10, 9);
  });

  it('за пределами интервала данных нет', () => {
    expect(sampleAt(depth, [10, 20, 30], 99.9)).toBeNull();
    expect(sampleAt(depth, [10, 20, 30], 102.1)).toBeNull();
  });

  it('не перешагивает через пропуск', () => {
    expect(sampleAt(depth, [10, null, 30], 101.5)).toBeNull();
  });
});

describe('resample', () => {
  it('кладёт кривую на равномерную ось', () => {
    const r = resample([100, 101, 102], [0, 10, 20], 100, 102, 0.5);
    expect([...r]).toEqual([0, 5, 10, 15, 20]);
  });

  it('оставляет пропуск пропуском, а не заполняет его', () => {
    // Размытый интервал — это отсутствие данных. Протянуть через него линию
    // значит выдумать ровно ту форму, по которой мы собираемся сопоставлять.
    const r = resample([100, 101, 102], [0, null, 20], 100, 102, 1);
    expect(Number.isNaN(r[1])).toBe(true);
  });
});

describe('correlateAt', () => {
  const a = Float64Array.from([1, 2, 3, 2, 1]);

  it('единица при полном совпадении формы', () => {
    expect(correlateAt(a, a, 0, 3)).toBeCloseTo(1, 9);
  });

  it('не зависит от единиц измерения: масштаб и сдвиг не меняют коэффициент', () => {
    const scaled = Float64Array.from([...a].map((v) => 17 + 4.2 * v));
    expect(correlateAt(a, scaled, 0, 3)).toBeCloseTo(1, 9);
  });

  it('минус единица при перевёрнутой форме', () => {
    const flipped = Float64Array.from([...a].map((v) => -v));
    expect(correlateAt(a, flipped, 0, 3)).toBeCloseTo(-1, 9);
  });

  it('с плоской кривой не коррелирует ничто', () => {
    expect(Number.isNaN(correlateAt(a, Float64Array.from([5, 5, 5, 5, 5]), 0, 3))).toBe(true);
  });

  it('слишком мало перекрытия — ответа нет', () => {
    const holed = Float64Array.from([NaN, NaN, 3, NaN, NaN]);
    expect(Number.isNaN(correlateAt(a, holed, 0, 3))).toBe(true);
  });
});

describe('propagatePick', () => {
  const ref = { well: well('A'), md: 2000 };

  it('находит тот же пласт, смещённый по глубине', () => {
    const p = propagatePick(ref, [well('B', { shift: 20 })])[0];
    expect(p.md).toBeCloseTo(2020, 0);
    expect(p.r).toBeGreaterThan(0.95);
    expect(p.shift).toBeCloseTo(20, 0);
    expect(isConvincing(p)).toBe(true);
  });

  it('находит его и вверх по разрезу', () => {
    const p = propagatePick(ref, [well('B', { shift: -35 })])[0];
    expect(p.md).toBeCloseTo(1965, 0);
    expect(p.r).toBeGreaterThan(0.95);
  });

  it('сопоставляет по форме, а не по величине', () => {
    // Разные приборы и единицы: мкР/ч против API — совпадать может только форма.
    const p = propagatePick(ref, [well('B', { shift: 12, scale: 0.043, offset: 7 })])[0];
    expect(p.md).toBeCloseTo(2012, 0);
    expect(p.r).toBeGreaterThan(0.95);
  });

  it('называет кривую, по которой сопоставлял', () => {
    expect(propagatePick(ref, [well('B', { shift: 5 })])[0].curve).toBe('GR');
  });

  it('ищет от подсказки, а не от глубины эталона', () => {
    // Подсказка сдвигает окно поиска: пласт лежит за пределами ±120 м от 2000,
    // но рядом с подсказкой — и находится.
    const target = well('B', { shift: 200 });
    const blind = propagatePick(ref, [target])[0];
    const hinted = propagatePick(ref, [target], () => 2200)[0];
    expect(hinted.md).toBeCloseTo(2200, 0);
    expect(hinted.r).toBeGreaterThan(0.95);
    expect(blind.r).toBeLessThan(hinted.r);
  });

  it('честно показывает слабое совпадение, а не молчит о нём', () => {
    // Плоская кривая ни на что не похожа: предложение может быть, но
    // коэффициент обязан это выдать.
    const p = propagatePick(ref, [well('B', { flat: true })])[0];
    expect(isConvincing(p)).toBe(false);
  });

  it('скважина без подходящей кривой отмечается, а не пропадает', () => {
    const p = propagatePick(ref, [well('B', { mnemonic: 'CALI' })])[0];
    expect(p.md).toBeNull();
    expect(p.reason).toBe('нет кривой');
  });

  it('пропуск в интервале поиска не обрушивает разнос', () => {
    const p = propagatePick(ref, [well('B', { shift: 20, gap: [1900, 1960] })])[0];
    expect(p.md).toBeCloseTo(2020, 0);
    expect(p.r).toBeGreaterThan(0.9);
  });

  it('разносит сразу по нескольким скважинам', () => {
    const ps = propagatePick(ref, [
      well('B', { shift: 10 }), well('C', { shift: -20 }), well('D', { shift: 45 }),
    ]);
    expect(ps.map((p) => Math.round(p.md!))).toEqual([2010, 1980, 2045]);
    expect(ps.every((p) => p.r > 0.95)).toBe(true);
  });

  it('не выходит за границы поиска', () => {
    const p = propagatePick(ref, [well('B', { shift: 20 })])[0];
    expect(Math.abs(p.shift)).toBeLessThanOrEqual(DEFAULT_CORRELATION.search + 1e-6);
  });

  it('эталон без кривой — разносить нечем', () => {
    const p = propagatePick({ well: well('A', { mnemonic: 'CALI' }), md: 2000 }, [well('B')])[0];
    expect(p.md).toBeNull();
    expect(p.reason).toBe('нет кривой');
  });

  it('у края каротажа окно неполное, но половины хватает', () => {
    // 2199 при забое 2200: в окно ±15 м попадает лишь 16 м записи — и этого
    // достаточно, чтобы узнать форму.
    const p = propagatePick({ well: well('A'), md: 2199 }, [well('B')])[0];
    expect(p.md).toBeCloseTo(2199, 0);
    expect(p.r).toBeGreaterThan(0.9);
  });

  it('когда записи в окне меньше половины, разносить не от чего', () => {
    const p = propagatePick({ well: well('A'), md: 2206 }, [well('B')])[0];
    expect(p.md).toBeNull();
    expect(p.reason).toBe('слишком короткий интервал');
  });
});
