import { describe, it, expect } from 'vitest';
import { buildSegyLinesCsv } from './segyLines';
import type { SegyLine } from '../seismic/segy';

const emptySection = { nTraces: 0, nSamples: 0, dt: 4, t0: 0, amp: new Float32Array(0), ampMax: 1 };

function line(over: Partial<SegyLine>): SegyLine {
  return { id: 'segy-1', label: 'Line 1', section: emptySection, coords: [], text: '', traceCount: 0, ...over };
}

describe('buildSegyLinesCsv', () => {
  it('writes one row per trace coordinate, unmarked as uncalibrated without a tie', () => {
    const lines = [line({ coords: [{ x: 10, y: 20 }, { x: 30, y: 40 }] })];
    const rows = buildSegyLinesCsv(lines).split('\n');
    expect(rows[0]).toBe('Line,Label,TraceIndex,X,Y,Calibrated');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe('segy-1,Line 1,0,10,20,0');
    expect(rows[2]).toBe('segy-1,Line 1,1,30,40,0');
  });

  it('runs coordinates through the tie transform and marks them calibrated', () => {
    // Tie: local (0,0)->map (1000,2000), local (10,0)->map (1000,2200) — 90° rotation, 2x scale.
    const tie: SegyLine['tie'] = [
      { local: { x: 0, y: 0 }, map: { x: 1000, y: 2000 } },
      { local: { x: 10, y: 0 }, map: { x: 1000, y: 2200 } },
    ];
    const lines = [line({ coords: [{ x: 0, y: 0 }, { x: 10, y: 0 }], tie })];
    const rows = buildSegyLinesCsv(lines).split('\n');
    expect(rows[1]).toBe('segy-1,Line 1,0,1000,2000,1');
    expect(rows[2]).toBe('segy-1,Line 1,1,1000,2200,1');
  });

  it('is just a header line when there are no lines or no coordinates', () => {
    expect(buildSegyLinesCsv([])).toBe('Line,Label,TraceIndex,X,Y,Calibrated');
    expect(buildSegyLinesCsv([line({})])).toBe('Line,Label,TraceIndex,X,Y,Calibrated');
  });
});
