import { describe, it, expect } from 'vitest';
import { buildFaultsCsv } from './faults';
import type { FaultDef } from '../store/slices/framework';
import type { Marker } from '../types';

const markers: Marker[] = [
  { id: 'm1', label: 'Top A', color: '#f00', depths: {} },
  { id: 'm2', label: 'KP S8', color: '#0f0', depths: {} },
];

describe('buildFaultsCsv', () => {
  it('writes one row per trace vertex, with per-fault fields repeated', () => {
    const faults: FaultDef[] = [
      { id: 'fault-1', label: 'Разлом 1', markerIds: ['m1', 'm2'], trace: [{ x: 10, y: 20 }, { x: 30, y: 40 }], dip: 45 },
    ];
    const rows = buildFaultsCsv(faults, markers).split('\n');
    expect(rows[0]).toBe('Fault,Label,PointIndex,X,Y,Dip,Cuts');
    expect(rows).toHaveLength(3); // header + 2 vertices
    expect(rows[1]).toBe('fault-1,Разлом 1,0,10,20,45,Top A;KP S8');
    expect(rows[2]).toBe('fault-1,Разлом 1,1,30,40,45,Top A;KP S8');
  });

  it('leaves dip empty when unset, rather than writing a fabricated value', () => {
    const faults: FaultDef[] = [{ id: 'fault-1', label: 'Разлом 1', markerIds: [], trace: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
    const rows = buildFaultsCsv(faults, markers).split('\n');
    expect(rows[1]).toBe('fault-1,Разлом 1,0,0,0,,');
  });

  it('resolves markerIds to labels, falling back to the id if the marker is gone', () => {
    const faults: FaultDef[] = [{ id: 'fault-1', label: 'Разлом 1', markerIds: ['m1', 'ghost'], trace: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
    const rows = buildFaultsCsv(faults, markers).split('\n');
    expect(rows[1]).toContain('Top A;ghost');
  });

  it('quotes a label containing a comma', () => {
    const faults: FaultDef[] = [{ id: 'fault-1', label: 'Разлом, боковой', markerIds: [], trace: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
    const rows = buildFaultsCsv(faults, markers).split('\n');
    expect(rows[1]).toContain('"Разлом, боковой"');
  });

  it('is just a header line when there are no faults', () => {
    expect(buildFaultsCsv([], markers)).toBe('Fault,Label,PointIndex,X,Y,Dip,Cuts');
  });
});
