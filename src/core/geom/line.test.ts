import { describe, it, expect } from 'vitest';
import { polylineLength, projectOntoPolyline, sampleAlongPolyline } from './line';

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
