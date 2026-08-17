import { describe, it, expect } from 'vitest';
import { polylineCrossings, polylineLength, projectOntoPolyline, sampleAlongPolyline } from './line';

const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]; // L-shape

describe('polylineLength', () => {
  it('суммирует длины отрезков', () => {
    expect(polylineLength(line)).toBeCloseTo(200, 6);
  });

  it('ноль для вырожденной линии', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([{ x: 5, y: 5 }])).toBe(0);
  });
});

describe('projectOntoPolyline', () => {
  it('точка на самой линии даёт perp = 0', () => {
    const p = projectOntoPolyline({ x: 50, y: 0 }, line);
    expect(p.perp).toBeCloseTo(0, 6);
    expect(p.arc).toBeCloseTo(50, 6);
  });

  it('учитывает излом — точка за поворотом проецируется на второй отрезок', () => {
    const p = projectOntoPolyline({ x: 100, y: 50 }, line);
    expect(p.perp).toBeCloseTo(0, 6);
    expect(p.arc).toBeCloseTo(150, 6); // 100 (первый отрезок) + 50
  });

  it('перпендикулярное расстояние измеряется до ближайшего отрезка, не до вершины', () => {
    const p = projectOntoPolyline({ x: 50, y: 10 }, line);
    expect(p.perp).toBeCloseTo(10, 6);
    expect(p.arc).toBeCloseTo(50, 6);
  });

  it('точка напротив конца отрезка привязывается к концу, а не улетает за него', () => {
    const p = projectOntoPolyline({ x: -20, y: 5 }, line);
    expect(p.arc).toBeCloseTo(0, 6); // клампится к началу, а не отрицательный arc
    expect(p.perp).toBeCloseTo(Math.hypot(20, 5), 6);
  });

  it('вырожденная линия из одной точки — расстояние до неё, arc = 0', () => {
    const p = projectOntoPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }]);
    expect(p.arc).toBe(0);
    expect(p.perp).toBeCloseTo(5, 6);
  });
});

describe('sampleAlongPolyline', () => {
  it('первая и последняя точки — концы линии', () => {
    const s = sampleAlongPolyline(line, 30);
    expect(s[0]).toMatchObject({ x: 0, y: 0, arc: 0 });
    const last = s[s.length - 1];
    expect(last.x).toBeCloseTo(100, 6);
    expect(last.y).toBeCloseTo(100, 6);
    expect(last.arc).toBeCloseTo(200, 6);
  });

  it('шаг примерно выдерживается и покрывает излом', () => {
    const s = sampleAlongPolyline(line, 25);
    for (let i = 1; i < s.length; i++) {
      expect(s[i].arc - s[i - 1].arc).toBeCloseTo(200 / (s.length - 1), 6);
    }
    // где-то в выборке должна встретиться точка на вершине излома (100,0)
    expect(s.some((p) => Math.abs(p.x - 100) < 1 && Math.abs(p.y) < 1)).toBe(true);
  });

  it('одна точка — вырожденная выборка без деления на ноль', () => {
    expect(sampleAlongPolyline([{ x: 5, y: 5 }], 10)).toEqual([{ x: 5, y: 5, arc: 0 }]);
  });
});

describe('polylineCrossings', () => {
  it('пересечение на первом отрезке даёт arc до точки пересечения', () => {
    const other = [{ x: 50, y: -20 }, { x: 50, y: 20 }];
    const arcs = polylineCrossings(line, other);
    expect(arcs.map((c) => c.arc)).toEqual([50]);
  });

  it('учитывает излом — пересечение на втором отрезке', () => {
    const other = [{ x: 80, y: 50 }, { x: 120, y: 50 }];
    const arcs = polylineCrossings(line, other);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].arc).toBeCloseTo(150, 6); // 100 (первый отрезок) + 50
  });

  it('несколько пересечений — все найдены и отсортированы', () => {
    const other = [{ x: 20, y: -10 }, { x: 20, y: 10 }, { x: 70, y: 10 }, { x: 70, y: -10 }];
    const arcs = polylineCrossings(line, other);
    expect(arcs).toHaveLength(2);
    expect(arcs[0].arc).toBeCloseTo(20, 6);
    expect(arcs[1].arc).toBeCloseTo(70, 6);
  });

  it('несёт локальные касательные обеих линий в точке пересечения', () => {
    const other = [{ x: 50, y: -20 }, { x: 50, y: 20 }]; // straight up (0,1)
    const [c] = polylineCrossings(line, other);
    expect(c.lineDir.x).toBeCloseTo(1, 6); // `line`'s first leg runs along +x
    expect(c.lineDir.y).toBeCloseTo(0, 6);
    expect(c.otherDir.x).toBeCloseTo(0, 6);
    expect(c.otherDir.y).toBeCloseTo(1, 6);
  });

  it('нет пересечений — пустой массив', () => {
    const other = [{ x: 500, y: 500 }, { x: 600, y: 600 }];
    expect(polylineCrossings(line, other)).toEqual([]);
  });

  it('вырожденные линии (меньше двух точек) не пересекаются', () => {
    expect(polylineCrossings(line, [{ x: 50, y: 0 }])).toEqual([]);
    expect(polylineCrossings([{ x: 50, y: 0 }], [{ x: 0, y: -1 }, { x: 0, y: 1 }])).toEqual([]);
  });

  it('находит пересечение, когда конец другой линии лежит ровно на этой (в пределах погрешности округления)', () => {
    // Воспроизводит реальный случай: точка разлома получена интерполяцией
    // вдоль ДРУГОЙ сейсмолинии по той же формуле, что и здесь — в точной
    // математике она лежит ровно на границе (u=0 или u=1), а в float — на
    // несколько ULP по любую сторону. Числа взяты из реального бага.
    const lineA = [{ x: 12000, y: 48000 }, { x: 13974, y: 48182 }];
    const lineB = [{ x: 12000, y: 48000 }, { x: 13785, y: 48895 }];
    const trace = [{ x: 13346.503311258279, y: 48124.14569536424 }, { x: 12981.15894039735, y: 48491.953642384105 }];
    expect(polylineCrossings(lineA, trace)).toHaveLength(1); // trace[0] lies exactly on lineA
    expect(polylineCrossings(lineB, trace)).toHaveLength(1); // trace[1] lies exactly on lineB
  });
});
