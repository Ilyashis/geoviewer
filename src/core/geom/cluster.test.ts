import { describe, it, expect } from 'vitest';
import { clusterPoints, clusterGap } from './cluster';

const p = (x: number, y: number) => ({ x, y, z: 0 });

describe('clusterPoints', () => {
  it('видит одно месторождение как одну группу', () => {
    const field = [p(0, 0), p(1000, 0), p(0, 1200), p(900, 1100), p(500, 600)];
    expect(clusterPoints(field)).toHaveLength(1);
  });

  it('разделяет две площади, разнесённые на десятки километров', () => {
    const two = [
      p(0, 0), p(1000, 0), p(500, 900),
      p(60000, 0), p(61000, 0), p(60500, 900),
    ];
    const cl = clusterPoints(two);
    expect(cl).toHaveLength(2);
    expect(cl[0].members).toHaveLength(3);
    expect(clusterGap(cl[0], cl[1]) / 1000).toBeGreaterThan(50);
  });

  it('вылавливает одну забытую скважину рядом с настоящим полем', () => {
    // Ровно случай сохранённого проекта: демо-скважина за тысячи километров.
    const real = [p(462138, 7069252), p(462113, 7062056), p(472564, 7053978), p(460522, 7056658)];
    const cl = clusterPoints([...real, p(13098, 48804)]);
    expect(cl).toHaveLength(2);
    expect(cl[0].members).toHaveLength(4); // настоящее поле идёт первым
    expect(cl[1].members).toEqual([4]);
  });

  it('не дробит куст с боковыми стволами', () => {
    const pad = [p(0, 0), p(3, 0), p(0, 4), p(3, 4), p(2500, 0), p(0, 2000), p(2500, 2000)];
    expect(clusterPoints(pad)).toHaveLength(1);
  });

  it('совпадающие точки — это одна группа, а не ошибка', () => {
    expect(clusterPoints([p(5, 5), p(5, 5), p(5, 5)])).toHaveLength(1);
    expect(clusterPoints([p(1, 1)])).toHaveLength(1);
    expect(clusterPoints([])).toHaveLength(0);
  });

  it('границы группы охватывают её точки', () => {
    // Просвет задан явно — проверяются рамки, а не разбиение.
    const [c] = clusterPoints([p(10, 20), p(110, 20), p(60, 220)], 1000);
    expect([c.minX, c.maxX, c.minY, c.maxY]).toEqual([10, 110, 20, 220]);
  });
});

describe('clusterGap', () => {
  it('ноль у перекрывающихся групп', () => {
    const a = { members: [], minX: 0, maxX: 100, minY: 0, maxY: 100 };
    const b = { members: [], minX: 50, maxX: 150, minY: 50, maxY: 150 };
    expect(clusterGap(a, b)).toBe(0);
  });

  it('измеряет просвет между рамками, а не между центрами', () => {
    const a = { members: [], minX: 0, maxX: 100, minY: 0, maxY: 0 };
    const b = { members: [], minX: 400, maxX: 500, minY: 0, maxY: 0 };
    expect(clusterGap(a, b)).toBeCloseTo(300, 6);
  });
});
