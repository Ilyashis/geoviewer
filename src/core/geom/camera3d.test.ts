import { describe, it, expect } from 'vitest';
import { basisOf, eyeOf, frameBounds, project, projectWith, type Camera } from './camera3d';

const cam = (over: Partial<Camera> = {}): Camera => ({
  azimuth: 0, elevation: 0, distance: 1000,
  target: { x: 0, y: 0, z: 0 },
  vScale: 1, width: 800, height: 600, focal: 700,
  ...over,
});

describe('камера', () => {
  it('смотрит на цель: цель проецируется в центр экрана', () => {
    const c = cam();
    const p = project(c, c.target);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(400, 6);
    expect(p.y).toBeCloseTo(300, 6);
  });

  it('держит цель в центре при любом повороте', () => {
    for (const azimuth of [0, 1, 2.5, -3]) {
      for (const elevation of [-1, 0, 0.5, 1.2]) {
        const c = cam({ azimuth, elevation, target: { x: 500, y: -200, z: -2500 } });
        const p = project(c, c.target);
        expect(p.x).toBeCloseTo(400, 4);
        expect(p.y).toBeCloseTo(300, 4);
      }
    }
  });

  it('глаз стоит на заданном расстоянии от цели', () => {
    const c = cam({ azimuth: 0.7, elevation: 0.4, distance: 2500, target: { x: 10, y: 20, z: 0 } });
    const e = eyeOf(c);
    expect(Math.hypot(e.x - 10, e.y - 20, e.z - 0)).toBeCloseTo(2500, 6);
  });

  it('точка за спиной не рисуется', () => {
    const c = cam({ azimuth: 0, elevation: 0, distance: 1000 });
    // Камера стоит севернее цели и смотрит на юг; точка ещё севернее — позади.
    const p = project(c, { x: 0, y: 5000, z: 0 });
    expect(p.visible).toBe(false);
  });

  it('дальняя точка имеет большую глубину и меньше смещается от центра', () => {
    const c = cam();
    const near = project(c, { x: 100, y: 0, z: 0 });
    const far = project(c, { x: 100, y: -2000, z: 0 });
    expect(far.depth).toBeGreaterThan(near.depth);
    // Одинаковый сдвиг вбок при большей дальности даёт меньший сдвиг на экране.
    expect(Math.abs(far.x - 400)).toBeLessThan(Math.abs(near.x - 400));
  });

  it('вертикальное преувеличение растягивает только z', () => {
    const flat = cam({ elevation: 0.3, vScale: 1 });
    const tall = cam({ elevation: 0.3, vScale: 10 });
    const p = { x: 0, y: 0, z: -100 };
    const a = project(flat, p), b = project(tall, p);
    // По вертикали точка уходит дальше от центра, по горизонтали — на месте.
    expect(Math.abs(b.y - 300)).toBeGreaterThan(Math.abs(a.y - 300));
    expect(b.x).toBeCloseTo(a.x, 6);
  });

  it('взгляд строго сверху не вырождается', () => {
    // elevation = π/2: направление взгляда параллельно «верху» мира, и наивное
    // векторное произведение даёт ноль.
    const c = cam({ elevation: Math.PI / 2, target: { x: 0, y: 0, z: 0 } });
    const b = basisOf(c);
    for (const v of [b.right, b.up, b.forward]) {
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6);
    }
    const p = project(c, { x: 100, y: 0, z: 0 });
    expect(p.visible).toBe(true);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('базис ортонормирован', () => {
    const b = basisOf(cam({ azimuth: 1.1, elevation: 0.6 }));
    const dot = (u: typeof b.right, v: typeof b.right) => u.x * v.x + u.y * v.y + u.z * v.z;
    expect(dot(b.right, b.up)).toBeCloseTo(0, 9);
    expect(dot(b.right, b.forward)).toBeCloseTo(0, 9);
    expect(dot(b.up, b.forward)).toBeCloseTo(0, 9);
    expect(dot(b.right, b.right)).toBeCloseTo(1, 9);
  });

  it('projectWith повторяет project, но с готовым базисом', () => {
    const c = cam({ azimuth: 0.9, elevation: 0.3 });
    const p = { x: 300, y: -120, z: -2400 };
    expect(projectWith(c, basisOf(c), p)).toEqual(project(c, p));
  });
});

describe('frameBounds', () => {
  const bounds = { minX: 0, maxX: 4000, minY: 0, maxY: 3000, minZ: -2600, maxZ: -2400 };

  it('целится в середину объёма', () => {
    const c = frameBounds(bounds, 800, 600, 10);
    expect(c.target).toEqual({ x: 2000, y: 1500, z: -2500 });
  });

  it('кадрирует и мелкое, и крупное поле', () => {
    const small = frameBounds({ ...bounds, maxX: 400, maxY: 300 }, 800, 600, 10);
    const big = frameBounds({ ...bounds, maxX: 70000, maxY: 60000 }, 800, 600, 10);
    // Дистанция следует за размером — иначе одно поле уходит в точку, другое за экран.
    expect(big.distance).toBeGreaterThan(small.distance * 10);

    for (const c of [small, big]) {
      const corners = [
        { x: c.target.x - 1, y: c.target.y - 1, z: bounds.minZ },
        { x: c.target.x + 1, y: c.target.y + 1, z: bounds.maxZ },
      ];
      for (const p of corners) expect(project(c, p).visible).toBe(true);
    }
  });

  it('учитывает преувеличение при выборе дистанции', () => {
    const flat = frameBounds(bounds, 800, 600, 1);
    const tall = frameBounds(bounds, 800, 600, 40);
    expect(tall.distance).toBeGreaterThan(flat.distance);
  });
});
