import { describe, it, expect } from 'vitest';
import { buildDevFile } from './dev';
import { parseDev } from '../wells/dev';
import { computeTrajectory } from '../wells/deviation';
import type { Well } from '../types';

function well(over: Partial<Well>): Well {
  return { id: 'w1', name: 'UT-1', depth: [], depthUnit: 'M', curves: [], lithology: [], header: {}, ...over };
}

/** Numeric data rows only (skip the '#' header block), as [md, x, y, z, tvd, ...]. */
function dataRows(text: string): number[][] {
  return text.split('\n')
    .filter((l) => l.trim() && !l.startsWith('#') && /^\s*-?[\d.]/.test(l))
    .map((l) => l.trim().split(/\s+/).map(Number));
}

describe('buildDevFile', () => {
  it('round-trips a vertical well as a two-row stub', () => {
    const w = well({ x: 1000, y: 2000, kb: 7.6, depth: [0, 3000] });
    const out = buildDevFile(w);
    const parsed = parseDev(out);
    expect(parsed.well).toBe('UT-1');
    expect(parsed.x).toBeCloseTo(1000, 4);
    expect(parsed.y).toBeCloseTo(2000, 4);
    expect(parsed.kb).toBeCloseTo(7.6, 4);
    expect(parsed.deviated).toBe(false);
  });

  it('writes the exact X/Y/Z/TVD the trajectory computes at every station', () => {
    const w = well({
      x: 1000, y: 2000, kb: 10,
      survey: [{ md: 0, inc: 0, azi: 0 }, { md: 1000, inc: 30, azi: 90 }],
    });
    const traj = computeTrajectory(w.survey!);
    const rows = dataRows(buildDevFile(w));
    expect(rows).toHaveLength(traj.length);
    rows.forEach(([md, x, y, z, tvd], i) => {
      const t = traj[i];
      expect(md).toBeCloseTo(t.md, 2);
      expect(x).toBeCloseTo(1000 + t.east, 2);
      expect(y).toBeCloseTo(2000 + t.north, 2);
      expect(z).toBeCloseTo(10 - t.tvd, 2); // Z is elevation: KB minus TVD
      expect(tvd).toBeCloseTo(t.tvd, 2);
    });
  });

  it('a deviated well parses back as deviated, in the right ballpark position-wise', () => {
    // Re-deriving inc/azi from XYZ chords (parseDev's job, not this file's)
    // is a lossy, well-documented approximation for a curved path — this
    // just checks buildDevFile hands it a file that survives that round
    // trip roughly intact, not that the approximation itself is exact.
    const survey = Array.from({ length: 11 }, (_, i) => ({ md: i * 100, inc: i * 3, azi: 90 }));
    const w = well({ x: 1000, y: 2000, kb: 10, survey });
    const original = computeTrajectory(survey);
    const parsed = parseDev(buildDevFile(w));
    expect(parsed.deviated).toBe(true);
    expect(parsed.survey).toHaveLength(11);
    const rebuilt = computeTrajectory(parsed.survey);
    const last = rebuilt[rebuilt.length - 1], want = original[original.length - 1];
    expect(Math.abs(last.east - want.east)).toBeLessThan(0.25 * Math.abs(want.east));
    expect(Math.abs(last.tvd - want.tvd)).toBeLessThan(0.1 * Math.abs(want.tvd));
  });

  it('places the wellhead at the well\'s X/Y, not the origin', () => {
    const w = well({ x: 500, y: -300, kb: 0, survey: [{ md: 0, inc: 0, azi: 0 }, { md: 500, inc: 20, azi: 180 }] });
    const out = buildDevFile(w);
    const parsed = parseDev(out);
    expect(parsed.x).toBeCloseTo(500, 4);
    expect(parsed.y).toBeCloseTo(-300, 4);
  });

  it('a well with no coordinates and no logs still produces a minimal, parseable file', () => {
    const w = well({});
    const out = buildDevFile(w);
    expect(() => parseDev(out)).not.toThrow();
  });
});
