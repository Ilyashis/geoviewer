import { describe, it, expect } from 'vitest';
import { faultCurtain, rampRgb, surfaceMesh } from './mesh';
import type { Grid } from '../../core/geom/grid';

/** A grid with the given z values, row-major, 1 unit cells from the origin. */
const grid = (nx: number, ny: number, z: number[]): Grid => ({
  z: Float64Array.from(z), nx, ny, minX: 0, minY: 0, dx: 1, dy: 1,
  zmin: Math.min(...z.filter(Number.isFinite)),
  zmax: Math.max(...z.filter(Number.isFinite)),
});

describe('surfaceMesh', () => {
  it('строит по два треугольника на ячейку', () => {
    const m = surfaceMesh(grid(3, 3, [0, 1, 2, 1, 2, 3, 2, 3, 4]))!;
    expect(m.positions).toHaveLength(9 * 3);
    expect(m.indices).toHaveLength(4 * 6); // 2×2 ячейки × 2 треугольника × 3 вершины
  });

  it('раскладывает узлы по координатам сетки', () => {
    const m = surfaceMesh(grid(2, 2, [10, 11, 12, 13]))!;
    expect([...m.positions.slice(0, 3)]).toEqual([0, 0, 10]);
    expect([...m.positions.slice(3, 6)]).toEqual([1, 0, 11]);
    expect([...m.positions.slice(6, 9)]).toEqual([0, 1, 12]);
  });

  it('не триангулирует ячейку с неизвестным углом', () => {
    // Пустая ячейка — это «нет данных»; натянуть на неё полотно значит
    // выдумать структуру ровно там, где карта честно оставила пробел.
    const full = surfaceMesh(grid(3, 3, [0, 1, 2, 1, 2, 3, 2, 3, 4]))!;
    expect(full.indices.length).toBeGreaterThan(0);
    // Узел в середине входит во все четыре ячейки — не остаётся ни одной,
    // и рисовать становится нечего.
    expect(surfaceMesh(grid(3, 3, [0, 1, 2, 1, NaN, 3, 2, 3, 4]))).toBeNull();
  });

  it('оставляет соседние ячейки, когда дыра с краю', () => {
    const m = surfaceMesh(grid(3, 3, [NaN, 1, 2, 1, 2, 3, 2, 3, 4]))!;
    expect(m.indices).toHaveLength(3 * 6); // выпала только левая нижняя
  });

  it('в буфере координат нет NaN — иначе меш пропадает целиком', () => {
    // Один NaN в позициях портит ограничивающую сферу, и three.js перестаёт
    // рисовать всю поверхность, а не одну ячейку.
    const m = surfaceMesh(grid(3, 3, [NaN, 1, 2, 1, 2, 3, 2, 3, 4]))!;
    expect([...m.positions].every(Number.isFinite)).toBe(true);
    expect([...m.colors].every(Number.isFinite)).toBe(true);
  });

  it('красит по глубине: ниже — другой конец шкалы', () => {
    const m = surfaceMesh(grid(2, 2, [0, 0, -100, -100]))!;
    const shallow = [...m.colors.slice(0, 3)];
    const deep = [...m.colors.slice(6, 9)];
    expect(shallow).not.toEqual(deep);
  });

  it('возвращает null, когда рисовать нечего', () => {
    expect(surfaceMesh(grid(2, 2, [NaN, NaN, NaN, NaN]))).toBeNull();
    expect(surfaceMesh(grid(1, 1, [5]))).toBeNull();
  });
});

describe('rampRgb', () => {
  it('держится в диапазоне 0…1 и на границах не выходит за шкалу', () => {
    for (const t of [-1, 0, 0.37, 1, 2]) {
      const c = rampRgb(t);
      expect(c).toHaveLength(3);
      expect(c.every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it('меняется монотонно по концам шкалы', () => {
    expect(rampRgb(0)).not.toEqual(rampRgb(1));
  });
});

describe('faultCurtain', () => {
  it('делает по два треугольника на звено трассы', () => {
    const c = faultCurtain([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], -3000, -2000)!;
    expect(c.positions).toHaveLength(3 * 2 * 3); // верх и низ на каждую вершину
    expect(c.indices).toHaveLength(2 * 6);
  });

  it('натягивает полотно между указанными отметками', () => {
    const c = faultCurtain([{ x: 1, y: 2 }, { x: 3, y: 4 }], -3000, -2000)!;
    expect([...c.positions.slice(0, 3)]).toEqual([1, 2, -2000]);
    expect([...c.positions.slice(3, 6)]).toEqual([1, 2, -3000]);
  });

  it('одной точки для плоскости мало', () => {
    expect(faultCurtain([{ x: 0, y: 0 }], -3000, -2000)).toBeNull();
  });
});
