import { describe, it, expect } from 'vitest';
import { velocityAt, depthToTwt, twtToDepth, avgVelocityTo, calibrateVelocity, DEFAULT_VELOCITY, COMPACTION, type VelocityModel } from './model';

describe('constant velocity', () => {
  const m = DEFAULT_VELOCITY; // 2200 m/s
  it('depth↔TWT round-trips', () => {
    expect(depthToTwt(m, 2000)).toBeCloseTo(1818.18, 1);
    expect(twtToDepth(m, 1818.18)).toBeCloseTo(2000, 1);
  });
  it('velocity is flat and equals the average', () => {
    expect(velocityAt(m, 0)).toBe(2200);
    expect(velocityAt(m, 3000)).toBe(2200);
    expect(avgVelocityTo(m, 2500)).toBeCloseTo(2200, 6);
  });
});

describe('linear (compaction) velocity', () => {
  const m = COMPACTION; // v0=1800, k=0.45
  it('velocity increases linearly with depth', () => {
    expect(velocityAt(m, 0)).toBe(1800);
    expect(velocityAt(m, 2000)).toBeCloseTo(2700, 6);
  });
  it('depth→TWT→depth is an exact inverse pair', () => {
    for (const z of [250, 1000, 2000, 3500]) {
      expect(twtToDepth(m, depthToTwt(m, z))).toBeCloseTo(z, 6);
    }
  });
  it('average velocity lies between the shallow and deep instantaneous values', () => {
    const avg = avgVelocityTo(m, 2000);
    expect(avg).toBeGreaterThan(velocityAt(m, 0));
    expect(avg).toBeLessThan(velocityAt(m, 2000));
    expect(avg).toBeCloseTo(2220, 0); // near the old constant 2200 by design
  });
  it('is monotonic: deeper is always later', () => {
    expect(depthToTwt(m, 2100)).toBeGreaterThan(depthToTwt(m, 2000));
  });
});

describe('linear degenerates to constant as k→0', () => {
  it('matches the constant model when k is ~0', () => {
    const flat: VelocityModel = { kind: 'linear', v0: 2200, k: 0 };
    expect(depthToTwt(flat, 2000)).toBeCloseTo(depthToTwt(DEFAULT_VELOCITY, 2000), 6);
    expect(twtToDepth(flat, 1800)).toBeCloseTo(twtToDepth(DEFAULT_VELOCITY, 1800), 6);
  });
});

describe('calibrateVelocity', () => {
  it('recovers a linear model from clean depth/time ties', () => {
    const truth: VelocityModel = { kind: 'linear', v0: 1900, k: 0.38 };
    const depths = [800, 1500, 2000, 2600, 3200];
    const samples = depths.map((d) => ({ depth: d, twt: depthToTwt(truth, d) }));
    const fit = calibrateVelocity(samples);
    expect(fit.kind).toBe('linear');
    // converting each true time back gives the known depth to within a couple metres
    for (const d of depths) expect(Math.abs(twtToDepth(fit, depthToTwt(truth, d)) - d)).toBeLessThan(3);
  });

  it('returns a constant when the ties come from a constant velocity', () => {
    const samples = [1000, 2000, 3000].map((d) => ({ depth: d, twt: depthToTwt(DEFAULT_VELOCITY, d) }));
    expect(calibrateVelocity(samples)).toEqual({ kind: 'const', v: 2200 });
  });

  it('falls back to a default with too few ties', () => {
    expect(calibrateVelocity([{ depth: 2000, twt: 1800 }])).toEqual(DEFAULT_VELOCITY);
  });
});
