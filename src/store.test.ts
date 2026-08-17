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

describe('затравка разбивок (addMarkerAtDepth и новая скважина в поле)', () => {
  beforeEach(() => useStore.getState().clearAll());

  const las = (name: string, x: number, y: number, kb: number) => `~V
 VERS. 2.0 :
 WRAP. NO :
~W
 NULL. -999.25 :
 WELL. ${name} :
 XCOORD.M ${x} :
 YCOORD.M ${y} :
 EKB.M ${kb} :
~C
 DEPT.M :
 GR.GAPI :
~A
1900 40
2900 40`;

  it('на активной скважине ставит ровно указанную глубину', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 20), 'A.las');
    const a = useStore.getState().wells[0];
    useStore.getState().addMarkerAtDepth(a.id, 2500);
    expect(useStore.getState().markers[0].depths[a.id]).toBe(2500);
  });

  it('затравливает уже загруженную скважину по TVDSS, а не той же глубиной', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 40), 'A.las');
    useStore.getState().loadLasText(las('B', 100, 0, 15), 'B.las');
    const [a, b] = useStore.getState().wells;

    useStore.getState().addMarkerAtDepth(a.id, 2500);

    const depths = useStore.getState().markers[0].depths;
    expect(depths[a.id]).toBe(2500);
    // TVDSS(A) = 2500 − 40 = 2460 = TVD(B) − 15 ⇒ MD(B) = 2475, не 2500:
    // разница KB не должна превращаться в готовую ошибку разбивки.
    expect(depths[b.id]).toBeCloseTo(2475, 6);
  });

  it('новая скважина, добавленная в поле с уже расставленной разбивкой, затравливается от ближайшей', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 40), 'A.las');
    const a = useStore.getState().wells[0];
    useStore.getState().addMarkerAtDepth(a.id, 2500);

    useStore.getState().loadLasText(las('B', 100, 0, 15), 'B.las');
    const b = useStore.getState().wells.find((w) => w.name === 'B')!;

    expect(useStore.getState().markers[0].depths[b.id]).toBeCloseTo(2475, 6);
  });
});

describe('провенанс затравленных глубин: seeded не должен сойти за настоящий пик', () => {
  beforeEach(() => useStore.getState().clearAll());

  const las = (name: string, x: number, y: number, kb: number) => `~V
 VERS. 2.0 :
 WRAP. NO :
~W
 NULL. -999.25 :
 WELL. ${name} :
 XCOORD.M ${x} :
 YCOORD.M ${y} :
 EKB.M ${kb} :
~C
 DEPT.M :
 GR.GAPI :
~A
1900 40
2900 40`;

  it('реальный пик не помечается как затравка', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 40), 'A.las');
    const a = useStore.getState().wells[0];
    useStore.getState().addMarkerAtDepth(a.id, 2500);
    expect(useStore.getState().markers[0].seeded ?? []).not.toContain(a.id);
  });

  it('соседи, получившие глубину без клика, помечены как затравка', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 40), 'A.las');
    useStore.getState().loadLasText(las('B', 100, 0, 15), 'B.las');
    const [a, b] = useStore.getState().wells;
    useStore.getState().addMarkerAtDepth(a.id, 2500);
    expect(useStore.getState().markers[0].seeded).toEqual([b.id]);
  });

  it('новая скважина, подхватившая соседнюю разбивку, тоже помечена', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 40), 'A.las');
    const a = useStore.getState().wells[0];
    useStore.getState().addMarkerAtDepth(a.id, 2500);

    useStore.getState().loadLasText(las('B', 100, 0, 15), 'B.las');
    const b = useStore.getState().wells.find((w) => w.name === 'B')!;
    expect(useStore.getState().markers[0].seeded).toContain(b.id);
  });

  it('ручная правка снимает пометку, даже если число не изменилось', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 40), 'A.las');
    useStore.getState().loadLasText(las('B', 100, 0, 15), 'B.las');
    const [a, b] = useStore.getState().wells;
    useStore.getState().addMarkerAtDepth(a.id, 2500);

    const markerId = useStore.getState().markers[0].id;
    const seededDepth = useStore.getState().markers[0].depths[b.id];
    useStore.getState().updateMarkerDepth(markerId, b.id, seededDepth); // геолог посмотрел и согласился

    expect(useStore.getState().markers[0].seeded ?? []).not.toContain(b.id);
    expect(useStore.getState().markers[0].depths[b.id]).toBe(seededDepth); // само число не изменилось
  });

  it('удаление глубины снимает пометку вместе с ней', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 40), 'A.las');
    useStore.getState().loadLasText(las('B', 100, 0, 15), 'B.las');
    const [a, b] = useStore.getState().wells;
    useStore.getState().addMarkerAtDepth(a.id, 2500);

    const markerId = useStore.getState().markers[0].id;
    useStore.getState().removeMarkerDepth(markerId, b.id);

    expect(useStore.getState().markers[0].seeded ?? []).not.toContain(b.id);
    expect(useStore.getState().markers[0].depths[b.id]).toBeUndefined();
  });

  it('импорт разбивок из файла перекрывает затравку настоящим значением', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 40), 'A.las');
    useStore.getState().loadLasText(las('B', 100, 0, 15), 'B.las');
    const [a, b] = useStore.getState().wells;
    useStore.getState().addMarkerAtDepth(a.id, 2500);

    const label = useStore.getState().markers[0].label;
    useStore.getState().importTops([{ well: 'B', surface: label, depth: 2510 }]);

    const marker = useStore.getState().markers[0];
    expect(marker.depths[b.id]).toBe(2510); // импорт побеждает затравку
    expect(marker.seeded ?? []).not.toContain(b.id);
  });

  it('разбивка, целиком созданная импортом, не содержит затравленных глубин', () => {
    useStore.getState().loadLasText(las('A', 0, 0, 40), 'A.las');
    useStore.getState().importTops([{ well: 'A', surface: 'Import Top', depth: 2500 }]);
    expect(useStore.getState().markers[0].seeded ?? []).toEqual([]);
  });
});
