import { describe, it, expect } from 'vitest';
import { triSample, makeTriParams, monteCarlo } from './uncertainty';

const M3_TO_BBL = 6.289810;

describe('triSample', () => {
  it('stays within [low, high] and hits the ends', () => {
    const t = { low: 2, mode: 5, high: 10 };
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const x = triSample(t, Math.min(u, 0.999999));
      expect(x).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(x).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(triSample(t, 0)).toBeCloseTo(2, 6);
    expect(triSample({ low: 4, mode: 4, high: 4 }, 0.7)).toBe(4);
  });
});

describe('monteCarlo', () => {
  const base = { ng: 0.5, phi: 0.2, sw: 0.25, bo: 1.25, rf: 0.3 };
  const grv = 1e6;
  const detStooip = grv * 0.5 * 0.2 * 0.75 / 1.25 * M3_TO_BBL; // 377388.6

  it('collapses to the deterministic value at zero spread', () => {
    const r = monteCarlo(grv, makeTriParams(base, 0));
    expect(r.stooip.p50).toBeCloseTo(detStooip, 2);
    expect(r.stooip.p90).toBeCloseTo(detStooip, 2);
    expect(r.stooip.p10).toBeCloseTo(detStooip, 2);
    expect(r.recoverable.p50).toBeCloseTo(detStooip * 0.3, 2);
  });

  it('orders P90 ≤ P50 ≤ P10 and brackets the deterministic case', () => {
    const r = monteCarlo(grv, makeTriParams(base, 0.25));
    expect(r.stooip.p90).toBeLessThan(r.stooip.p50);
    expect(r.stooip.p50).toBeLessThan(r.stooip.p10);
    expect(r.stooip.p90).toBeLessThan(detStooip);
    expect(r.stooip.p10).toBeGreaterThan(detStooip);
    expect(r.recoverable.p90).toBeLessThan(r.recoverable.p10);
  });

  it('is reproducible for a fixed seed', () => {
    const a = monteCarlo(grv, makeTriParams(base, 0.2));
    const b = monteCarlo(grv, makeTriParams(base, 0.2));
    expect(a.stooip.p50).toBe(b.stooip.p50);
    expect(a.stooip.p10).toBe(b.stooip.p10);
  });
});

describe('makeTriParams', () => {
  it('clamps unit fractions to [0,1] and keeps Bo positive', () => {
    const p = makeTriParams({ ng: 0.9, phi: 0.3, sw: 0.9, bo: 1.1, rf: 0.9 }, 0.5);
    expect(p.ng.high).toBeLessThanOrEqual(1);
    expect(p.sw.high).toBeLessThanOrEqual(1);
    expect(p.rf.high).toBeLessThanOrEqual(1);
    expect(p.bo.low).toBeGreaterThan(0);
    expect(p.ng.mode).toBeCloseTo(0.9, 6);
  });
});
