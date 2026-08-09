import { describe, it, expect } from 'vitest';
import { eyeFor, framingFor, START_AZIMUTH, START_ELEVATION, type Bounds } from './camera3d';

const bounds: Bounds = { minX: 0, maxX: 4000, minY: 0, maxY: 3000, minZ: -2600, maxZ: -2400 };

describe('framingFor', () => {
  it('целится в середину объёма', () => {
    expect(framingFor(bounds, 10).target).toEqual({ x: 2000, y: 1500, z: -2500 });
  });

  it('дистанция следует за размером поля', () => {
    // 4 × 3 км и 70 × 60 км должны прийти на экран одинаково укомплектованными.
    const small = framingFor({ ...bounds, maxX: 400, maxY: 300 }, 10);
    const big = framingFor({ ...bounds, maxX: 70000, maxY: 60000 }, 10);
    expect(big.distance).toBeGreaterThan(small.distance * 10);
  });

  it('учитывает вертикальное преувеличение', () => {
    // При ×40 рельеф в 200 м превращается в 8 км модели, которые тоже надо вместить.
    const flat = framingFor(bounds, 1);
    const tall = framingFor(bounds, 40);
    expect(tall.distance).toBeGreaterThan(flat.distance * 1.5);
  });

  it('не вырождается на плоском или точечном объёме', () => {
    const flat = framingFor({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }, 10);
    expect(Number.isFinite(flat.distance)).toBe(true);
    expect(flat.distance).toBeGreaterThan(0);
  });
});

describe('eyeFor', () => {
  const f = framingFor(bounds, 10);

  it('глаз стоит на заданном расстоянии от цели (в растянутых координатах)', () => {
    const e = eyeFor(f, 10, START_AZIMUTH, START_ELEVATION);
    const d = Math.hypot(e.x - f.target.x, e.y - f.target.y, e.z - f.target.z * 10);
    expect(d).toBeCloseTo(f.distance, 6);
  });

  it('поднимается над целью при положительном возвышении', () => {
    const low = eyeFor(f, 10, 0, 0.05);
    const high = eyeFor(f, 10, 0, 1.2);
    expect(high.z).toBeGreaterThan(low.z);
  });

  it('азимут вращает глаз вокруг цели по горизонтали', () => {
    const north = eyeFor(f, 10, 0, 0);
    const east = eyeFor(f, 10, Math.PI / 2, 0);
    expect(north.y).toBeGreaterThan(f.target.y);      // 0 — взгляд с севера
    expect(east.x).toBeGreaterThan(f.target.x);       // π/2 — с востока
    expect(east.y).toBeCloseTo(f.target.y, 6);
  });

  it('высота глаза считается от растянутой цели', () => {
    // Иначе при большом преувеличении камера оказывается внутри модели.
    const a = eyeFor(f, 1, 0, 0);
    const b = eyeFor(f, 40, 0, 0);
    expect(b.z).toBeCloseTo(f.target.z * 40, 6);
    expect(a.z).toBeCloseTo(f.target.z * 1, 6);
  });
});
