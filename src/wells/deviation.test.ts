import { describe, it, expect } from 'vitest';
import { computeTrajectory, positionAtMd, tvdAtMd, type SurveyStation } from './deviation';

describe('computeTrajectory (minimum curvature)', () => {
  it('keeps a vertical well vertical (TVD = MD, no offset)', () => {
    const t = computeTrajectory([{ md: 0, inc: 0, azi: 0 }, { md: 3000, inc: 0, azi: 0 }]);
    const p = positionAtMd(t, 1500);
    expect(p.tvd).toBeCloseTo(1500, 6);
    expect(p.north).toBeCloseTo(0, 6);
    expect(p.east).toBeCloseTo(0, 6);
  });

  it('matches the known minimum-curvature build (0→90° over 1000 m, due north)', () => {
    const survey: SurveyStation[] = [
      { md: 0, inc: 0, azi: 0 }, { md: 1000, inc: 0, azi: 0 }, { md: 2000, inc: 90, azi: 0 },
    ];
    const t = computeTrajectory(survey);
    const end = t[t.length - 1];
    expect(end.tvd).toBeCloseTo(1636.62, 1);   // 1000 + 500·rf, rf = 4/π
    expect(end.north).toBeCloseTo(636.62, 1);
    expect(end.east).toBeCloseTo(0, 6);
    expect(end.tvd).toBeLessThan(end.md);       // deviated ⇒ TVD < MD
  });

  it('interpolates within a segment', () => {
    const t = computeTrajectory([{ md: 0, inc: 0, azi: 0 }, { md: 1000, inc: 0, azi: 0 }, { md: 2000, inc: 90, azi: 0 }]);
    const p = positionAtMd(t, 1500);
    expect(p.tvd).toBeCloseTo(1000 + 636.62 * 0.5, 1);
    expect(p.north).toBeCloseTo(636.62 * 0.5, 1);
  });

  it('drifts east for a 90° azimuth and TVD stops increasing when horizontal', () => {
    const t = computeTrajectory([{ md: 0, inc: 0, azi: 90 }, { md: 1000, inc: 90, azi: 90 }, { md: 1500, inc: 90, azi: 90 }]);
    const a = positionAtMd(t, 1000), b = positionAtMd(t, 1500);
    expect(b.east).toBeGreaterThan(a.east);       // still drifting east
    expect(b.north).toBeCloseTo(0, 4);
    expect(b.tvd).toBeCloseTo(a.tvd, 4);          // horizontal hold: no added TVD
  });

  it('falls back to vertical for an empty survey', () => {
    expect(tvdAtMd([], 2200)).toBe(2200);
  });
});
