import { describe, it, expect } from 'vitest';
import { tvdssAt, posAt, structuralControlPoints } from './structure';
import { computeTrajectory, type TrajPoint } from './deviation';
import type { Marker, Well } from '../types';

function well(over: Partial<Well>): Well {
  return { id: 'w1', name: 'W1', depth: [], depthUnit: 'M', curves: [], lithology: [], header: {}, ...over };
}

describe('tvdssAt / posAt', () => {
  it('falls back to MD = TVD, no offset, for a well with no trajectory', () => {
    const w = well({ x: 100, y: 200, kb: 10 });
    const trajs = new Map<string, TrajPoint[]>();
    expect(tvdssAt(trajs, w, 1000)).toBeCloseTo(990, 6); // tvdss = tvd - kb = 1000 - 10
    expect(posAt(trajs, w, 1000)).toEqual({ x: 100, y: 200 });
  });

  it('offsets by the trajectory north/east at a deviated station', () => {
    const w = well({ id: 'w1', x: 1000, y: 2000, kb: 0, survey: [{ md: 0, inc: 0, azi: 0 }, { md: 1000, inc: 30, azi: 90 }] });
    const trajs = new Map([[w.id, computeTrajectory(w.survey!)]]);
    const p = posAt(trajs, w, 1000);
    expect(p.x).toBeGreaterThan(1000); // stepped east
    expect(p.y).toBeCloseTo(2000, 6); // azimuth 90° = due east, no north component
  });
});

describe('structuralControlPoints', () => {
  it('collects one point per well that has a finite pick for the marker', () => {
    const wells = [well({ id: 'a', x: 0, y: 0, kb: 0 }), well({ id: 'b', x: 100, y: 0, kb: 0 }), well({ id: 'c', x: 200, y: 0, kb: 0 })];
    const marker: Marker = { id: 'm1', label: 'Top A', color: '#fff', depths: { a: 1000, b: 1050 } }; // c has no pick
    const trajs = new Map<string, TrajPoint[]>();
    const pts = structuralControlPoints(marker, wells, trajs);
    expect(pts).toHaveLength(2);
    expect(pts.map((p) => p.z)).toEqual([1000, 1050]);
  });

  it('skips non-finite picks', () => {
    const wells = [well({ id: 'a', x: 0, y: 0, kb: 0 })];
    const marker: Marker = { id: 'm1', label: 'Top A', color: '#fff', depths: { a: NaN } };
    expect(structuralControlPoints(marker, wells, new Map())).toEqual([]);
  });
});
