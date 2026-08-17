import { describe, it, expect } from 'vitest';
import type { Well } from '../types';
import { mdAtTvd, seedMarkerDepths } from './seed';
import { computeTrajectory, tvdAtMd } from './deviation';

const well = (over: Partial<Well> & { id: string }): Well => ({
  name: over.id, depth: [], depthUnit: 'M', lithology: [], header: {}, curves: [],
  ...over,
});

describe('mdAtTvd', () => {
  it('обращает tvdAtMd на вертикальном стволе (MD = TVD)', () => {
    expect(mdAtTvd([], 2500)).toBe(2500);
  });

  it('обращает tvdAtMd на наклонном стволе — round-trip для любой станции', () => {
    const traj = computeTrajectory([
      { md: 0, inc: 0, azi: 0 },
      { md: 1000, inc: 0, azi: 0 },
      { md: 1500, inc: 45, azi: 90 },
      { md: 2200, inc: 60, azi: 90 },
    ]);
    for (const p of traj) {
      expect(mdAtTvd(traj, p.tvd)).toBeCloseTo(p.md, 6);
    }
  });

  it('интерполирует между станциями симметрично tvdAtMd', () => {
    const traj = computeTrajectory([
      { md: 0, inc: 0, azi: 0 },
      { md: 2000, inc: 50, azi: 45 },
    ]);
    const midMd = 1234;
    const tvd = tvdAtMd(traj, midMd);
    expect(mdAtTvd(traj, tvd)).toBeCloseTo(midMd, 6);
  });

  it('экстраполирует ниже забоя вдоль последнего участка', () => {
    const traj = computeTrajectory([{ md: 0, inc: 0, azi: 0 }, { md: 1000, inc: 30, azi: 0 }]);
    const deepTvd = tvdAtMd(traj, 1500); // за пределами станций — уже экстраполяция tvdAtMd
    expect(mdAtTvd(traj, deepTvd)).toBeCloseTo(1500, 6);
  });
});

describe('seedMarkerDepths', () => {
  it('не трогает скважины, где глубина уже известна', () => {
    const wells = [well({ id: 'A', x: 0, y: 0 }), well({ id: 'B', x: 100, y: 0 })];
    const out = seedMarkerDepths(wells, { A: 2500, B: 2510 });
    expect(out.A).toEqual({ depth: 2500, source: null });
    expect(out.B).toEqual({ depth: 2510, source: null });
  });

  it('затравливает от ближайшей известной скважины, а не от первой попавшейся', () => {
    const wells = [
      well({ id: 'far', x: 5000, y: 0 }),
      well({ id: 'near', x: 100, y: 0 }),
      well({ id: 'target', x: 150, y: 0 }),
    ];
    // 'far' идёт первым в списке, но геометрически ближе 'near' — источник
    // должен определяться расстоянием, а не порядком в массиве.
    const out = seedMarkerDepths(wells, { far: 1000, near: 2500 });
    expect(out.target.source?.wellId).toBe('near');
    expect(out.target.depth).toBeCloseTo(2500, 6);
  });

  it('без наклона и без разницы KB — та же глубина, что у соседа', () => {
    const wells = [well({ id: 'A', x: 0, y: 0, kb: 20 }), well({ id: 'B', x: 100, y: 0, kb: 20 })];
    const out = seedMarkerDepths(wells, { A: 2500 });
    expect(out.B.depth).toBeCloseTo(2500, 6);
    expect(out.B.source).toEqual({ wellId: 'A', distance: 100 });
  });

  it('переносит TVDSS, а не сырой MD — разница KB не превращается в ошибку', () => {
    // A: KB 40, B: KB 15. Одна и та же кровля должна дать разные MD.
    const wells = [well({ id: 'A', x: 0, y: 0, kb: 40 }), well({ id: 'B', x: 100, y: 0, kb: 15 })];
    const out = seedMarkerDepths(wells, { A: 2500 });
    // TVDSS(A) = 2500 - 40 = 2460 = TVD(B) - 15 ⇒ MD(B) = 2475, а не 2500.
    expect(out.B.depth).toBeCloseTo(2475, 6);
  });

  it('учитывает наклон ствола при переносе', () => {
    const A = well({
      id: 'A', x: 0, y: 0,
      survey: [{ md: 0, inc: 0, azi: 0 }, { md: 3000, inc: 40, azi: 0 }],
    });
    const B = well({ id: 'B', x: 50, y: 0 }); // вертикальная соседка
    const traj = computeTrajectory(A.survey!);
    const srcMd = 2200;
    const srcTvd = tvdAtMd(traj, srcMd);

    const out = seedMarkerDepths([A, B], { A: srcMd });
    // У B (вертикальной, KB=0) MD должен равняться TVD пласта в A.
    expect(out.B.depth).toBeCloseTo(srcTvd, 3);
    expect(out.B.depth).not.toBeCloseTo(srcMd, 3); // иначе наклон просто проигнорирован
  });

  it('без координат — переносит сырую глубину, но не молчит об этом', () => {
    const wells = [well({ id: 'A', x: 0, y: 0 }), well({ id: 'B' /* нет x/y */ })];
    const out = seedMarkerDepths(wells, { A: 2500 });
    expect(out.B.depth).toBe(2500);
    expect(out.B.source?.wellId).toBe('A');
    expect(Number.isNaN(out.B.source!.distance)).toBe(true); // расстояние не измерялось
  });

  it('нечем затравить — скважина остаётся без предложения', () => {
    const wells = [well({ id: 'A', x: 0, y: 0 })];
    const out = seedMarkerDepths(wells, {});
    expect(out.A).toBeUndefined();
  });
});
