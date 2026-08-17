import { describe, it, expect } from 'vitest';
import { idwGrid, contourLevels, sampleGrid, type Grid } from './grid';
import { marchingSquares } from './contours';

describe('idwGrid', () => {
  it('reproduces control-point values at their locations', () => {
    const pts = [
      { x: 0, y: 0, z: 100 },
      { x: 10, y: 0, z: 200 },
      { x: 0, y: 10, z: 300 },
      { x: 10, y: 10, z: 400 },
    ];
    const g = idwGrid(pts, 0, 10, 0, 10, 11, 11);
    // corners equal their control points
    expect(g.z[0]).toBeCloseTo(100, 3);                    // (0,0)
    expect(g.z[10]).toBeCloseTo(200, 3);                   // (10,0)
    expect(g.z[10 * 11]).toBeCloseTo(300, 3);              // (0,10)
    expect(g.z[10 * 11 + 10]).toBeCloseTo(400, 3);         // (10,10)
    expect(g.zmin).toBeCloseTo(100, 1);
    expect(g.zmax).toBeCloseTo(400, 1);
  });

  it('keeps interpolated values within the data range', () => {
    const pts = [{ x: 0, y: 0, z: 50 }, { x: 100, y: 100, z: 150 }];
    const g = idwGrid(pts, 0, 100, 0, 100, 20, 20);
    for (let k = 0; k < g.z.length; k++) {
      expect(g.z[k]).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(g.z[k]).toBeLessThanOrEqual(150 + 1e-6);
    }
  });

  it('оставляет пустой ячейку, до которой не дотягивается ни одна точка', () => {
    // Две группы скважин в 50 км друг от друга: между ними структуры не знает
    // никто, и ноль там — не «нет данных», а уровень моря.
    const pts = [
      { x: 0, y: 0, z: -2500 }, { x: 400, y: 0, z: -2510 }, { x: 200, y: 400, z: -2505 },
      { x: 50000, y: 0, z: -2400 }, { x: 50400, y: 0, z: -2410 }, { x: 50200, y: 400, z: -2405 },
    ];
    const g = idwGrid(pts, 0, 50400, 0, 400, 127, 3);
    const at = (i: number, j: number) => g.z[j * 127 + i];

    expect(at(0, 0)).toBeCloseTo(-2500, 3);            // на скважине
    expect(Number.isFinite(at(63, 1))).toBe(false);    // ровно посередине пустоты
    expect(at(63, 1)).not.toBe(0);
    expect(g.zmin).toBeLessThan(-2000);                // NaN не портит диапазон
    expect(Number.isFinite(g.zmax)).toBe(true);
  });

  it('пустой блок разлома остаётся пустым, а не проваливается в ноль', () => {
    const pts = [{ x: 1, y: 1, z: -2500 }, { x: 2, y: 1, z: -2510 }, { x: 1.5, y: 2, z: -2505 }];
    const trace = [{ x: 5, y: -10 }, { x: 5, y: 10 }]; // все точки слева от разлома
    const g = idwGrid(pts, 0, 10, 0, 2, 11, 3, 2, [trace]);
    const right = g.z[1 * 11 + 8]; // ячейка в блоке без скважин
    expect(Number.isFinite(right)).toBe(false);
    expect(right).not.toBe(0);
  });

  it('боковые стволы с одного куста не схлопывают радиус', () => {
    // Четыре ствола с одного куста стоят почти в одной точке. По медианному
    // расстоянию до соседа радиус выходит метровым, и нормальное компактное
    // месторождение обнуляется целиком — так и случилось на реальных данных.
    const pad = [
      { x: 0, y: 0, z: 100 }, { x: 5, y: 0, z: 101 }, { x: 0, y: 5, z: 102 }, { x: 5, y: 5, z: 103 },
    ];
    const outliers = [{ x: 4000, y: 0, z: 110 }, { x: 0, y: 3000, z: 120 }, { x: 4000, y: 3000, z: 130 }];
    const g = idwGrid([...pad, ...outliers], 0, 4000, 0, 3000, 41, 31);

    const finite = [...g.z].filter((v) => Number.isFinite(v)).length;
    expect(finite).toBeGreaterThan(g.z.length * 0.8); // площадь между скважинами остаётся картой
  });

  it('явный радиус перекрывает подобранный по данным', () => {
    const pts = [{ x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 20 }, { x: 5, y: 8, z: 15 }];
    const wide = idwGrid(pts, 0, 10, 0, 8, 11, 9, 2, undefined, 1e9);
    expect(wide.z.every((v) => Number.isFinite(v))).toBe(true);

    const tight = idwGrid(pts, 0, 10, 0, 8, 11, 9, 2, undefined, 0.5);
    expect(tight.z.some((v) => !Number.isFinite(v))).toBe(true);
  });

  it('контуры не рисуются по краю пустоты', () => {
    // Половина грида пуста; изолиния не должна появиться на границе данных.
    const pts = [
      { x: 0, y: 0, z: 100 }, { x: 100, y: 0, z: 100 }, { x: 50, y: 100, z: 100 },
      { x: 40000, y: 0, z: 100 }, { x: 40100, y: 0, z: 100 }, { x: 40050, y: 100, z: 100 },
    ];
    const g = idwGrid(pts, 0, 40100, 0, 100, 81, 5);
    // Все известные значения равны 100, поэтому пересечений уровня 50 быть не может.
    expect(marchingSquares(g, 50)).toHaveLength(0);
  });

  it('a fault trace stops interpolation blending across it', () => {
    const pts = [{ x: 1, y: 1, z: 100 }, { x: 9, y: 1, z: 200 }];
    const trace = [{ x: 5, y: -10 }, { x: 5, y: 10 }];
    const kAt = (i: number, j: number) => j * 11 + i; // nx=11
    const noFault = idwGrid(pts, 0, 10, 0, 2, 11, 3);
    const faulted = idwGrid(pts, 0, 10, 0, 2, 11, 3, 2, [trace]);

    // Without a fault, a cell on the left still leans toward the right point.
    expect(noFault.z[kAt(4, 1)]).toBeGreaterThan(110);
    // With the fault, that same cell only ever sees the left point.
    expect(faulted.z[kAt(4, 1)]).toBeCloseTo(100, 3);
    // Symmetric on the other side.
    expect(noFault.z[kAt(6, 1)]).toBeLessThan(190);
    expect(faulted.z[kAt(6, 1)]).toBeCloseTo(200, 3);
  });
});

describe('contourLevels', () => {
  it('produces round levels inside the range', () => {
    expect(contourLevels(2000, 2080, 8)).toEqual([2010, 2020, 2030, 2040, 2050, 2060, 2070]);
  });
  it('is empty for a flat field', () => {
    expect(contourLevels(2000, 2000)).toEqual([]);
  });
});

describe('sampleGrid', () => {
  const flat = (nx: number, ny: number, z: number[]): Grid => ({
    z: Float64Array.from(z), nx, ny, minX: 0, minY: 0, dx: 1, dy: 1,
    zmin: Math.min(...z.filter(Number.isFinite)), zmax: Math.max(...z.filter(Number.isFinite)),
  });

  it('точно попадает в узел сетки', () => {
    const g = flat(2, 2, [10, 20, 30, 40]);
    expect(sampleGrid(g, 0, 0)).toBeCloseTo(10, 9);
    expect(sampleGrid(g, 1, 1)).toBeCloseTo(40, 9);
  });

  it('линейно интерполирует внутри ячейки', () => {
    const g = flat(2, 2, [0, 10, 0, 10]); // растёт только по x
    expect(sampleGrid(g, 0.5, 0)).toBeCloseTo(5, 9);
    expect(sampleGrid(g, 0.25, 1)).toBeCloseTo(2.5, 9);
  });

  it('вне сетки — NaN, а не экстраполяция', () => {
    const g = flat(2, 2, [0, 10, 0, 10]);
    expect(Number.isNaN(sampleGrid(g, -0.1, 0))).toBe(true);
    expect(Number.isNaN(sampleGrid(g, 1.1, 0))).toBe(true);
  });

  it('пустой угол ячейки — NaN на неё целиком, без сглаживания дыры', () => {
    // Сетка 4×4: NaN только в узле (0,0). В 3×3 центральный узел касается
    // всех четырёх ячеек сразу — там не нашлось бы «соседней целой» ячейки.
    const z = Array.from({ length: 16 }, (_, k) => k);
    z[0] = NaN; // узел (0,0)
    const g = flat(4, 4, z);
    expect(Number.isNaN(sampleGrid(g, 0.3, 0.3))).toBe(true); // ячейка (0,0)–(1,1) касается NaN-узла
    expect(sampleGrid(g, 2.5, 2.5)).not.toBeNaN(); // дальняя ячейка его не касается
  });
});

describe('marchingSquares', () => {
  it('cuts a planar field with a straight iso-line', () => {
    // z increases with i only → level 1.5 crosses between columns 1 and 2.
    const nx = 4, ny = 3;
    const z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = i;
    const grid = { z, nx, ny, minX: 0, minY: 0, dx: 1, dy: 1, zmin: 0, zmax: 3 };
    const segs = marchingSquares(grid, 1.5);
    expect(segs.length).toBeGreaterThan(0);
    // every crossing sits at i = 1.5 (vertical iso-line)
    for (const s of segs) {
      expect(s.i0).toBeCloseTo(1.5, 6);
      expect(s.i1).toBeCloseTo(1.5, 6);
    }
  });
});
