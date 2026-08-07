import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';

describe('loadDemoField', () => {
  beforeEach(() => useStore.getState().clearAll());

  it('loads a full demo field: named wells, seeded tops, some deviated, varied curves', () => {
    useStore.getState().loadDemoField(6);
    const { wells, markers } = useStore.getState();

    expect(wells).toHaveLength(6);
    expect(wells.map((w) => w.name)).toEqual(['UT-1058', 'UT-1059', 'UT-1060', 'UT-1061', 'UT-1062', 'UT-1063']);
    expect(markers.length).toBeGreaterThanOrEqual(3); // Top A, KP S8, Top B
    expect(wells.filter((w) => w.survey && w.survey.length).length).toBe(3); // every other well deviated
    expect(wells[0].curves.map((c) => c.mnemonic)).toEqual(['GR', 'RESD', 'NPHI', 'RHOB']);
    expect(Number.isFinite(wells[0].x) && Number.isFinite(wells[0].y)).toBe(true);

    // Curves differ well-to-well (seeded variation), so it isn't six identical logs.
    const gr0 = wells[0].curves[0].values, gr1 = wells[1].curves[0].values;
    expect(gr0.some((v, i) => v !== gr1[i])).toBe(true);
  });

  it('replaces the project rather than appending on a second call', () => {
    useStore.getState().loadDemoField(4);
    useStore.getState().loadDemoField(3);
    expect(useStore.getState().wells).toHaveLength(3);
  });
});
