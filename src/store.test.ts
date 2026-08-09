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

describe('importWellKb', () => {
  beforeEach(() => {
    useStore.getState().clearAll();
    useStore.getState().loadDemoField(2);
  });

  const wellNamed = (name: string) => useStore.getState().wells.find((w) => w.name === name)!;

  it('применяет альтитуду, не трогая координаты', () => {
    const before = wellNamed('UT-1058');
    const r = useStore.getState().importWellKb([{ well: 'UT-1058', kb: 142.5 }]);

    expect(r.wells).toBe(1);
    const after = wellNamed('UT-1058');
    expect(after.kb).toBeCloseTo(142.5, 6);
    // Инклинометрия не несёт координат — импорт альтитуды не должен их обнулять.
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });

  it('не задевает остальные скважины', () => {
    useStore.getState().importWellKb([{ well: 'UT-1058', kb: 142.5 }]);
    expect(wellNamed('UT-1059').kb).toBeUndefined();
  });

  it('сообщает о замене прежней альтитуды', () => {
    useStore.getState().importWellKb([{ well: 'UT-1058', kb: 100 }]);
    const r = useStore.getState().importWellKb([{ well: 'UT-1058', kb: 142.5 }]);

    // Отметка меняет все карты TVDSS, поэтому подмена не должна быть тихой.
    expect(r.replaced).toEqual([{ well: 'UT-1058', was: 100 }]);
    expect(wellNamed('UT-1058').kb).toBeCloseTo(142.5, 6);
  });

  it('не считает заменой повторную запись того же значения', () => {
    useStore.getState().importWellKb([{ well: 'UT-1058', kb: 142.5 }]);
    expect(useStore.getState().importWellKb([{ well: 'UT-1058', kb: 142.5 }]).replaced).toEqual([]);
  });

  it('возвращает скважины, которых нет в проекте', () => {
    const r = useStore.getState().importWellKb([{ well: 'НЕТ-1', kb: 10 }]);
    expect(r).toMatchObject({ wells: 0, unmatchedWells: ['НЕТ-1'] });
  });
});
