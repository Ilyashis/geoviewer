import { describe, it, expect } from 'vitest';
import { mapSurfaces, mapExtentPoints } from './mapSurfaces';
import type { Marker } from '../types';
import { horizonColorFor } from '../seismic/horizonColor';

const topA: Marker = { id: 'mA', label: 'Top A', color: '#AF52DE', depths: { a: 2000, b: 2040, c: 2020 } };
const topB: Marker = { id: 'mB', label: 'Top B', color: '#FF9500', depths: { a: 2100 } }; // exists, not mappable
const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: i * 5, z: 2000 + i }));

describe('mapSurfaces', () => {
  it('lists mappable пласты first, keyed by marker id', () => {
    const s = mapSurfaces([topA], [topA, topB], {}, false);
    expect(s).toEqual([{ id: 'mA', label: 'Top A', color: '#AF52DE', marker: topA }]);
  });

  it('does not list a seismic label twice when a mappable пласт already covers it', () => {
    const s = mapSurfaces([topA], [topA], { 'Top A': { A: pts(5) } }, false);
    expect(s.map((x) => x.label)).toEqual(['Top A']);
    expect(s[0].marker).toBe(topA);
  });

  it('adds a seismic-only surface for a label with no mappable пласт, with a stable id', () => {
    const s = mapSurfaces([topA], [topA], { 'Горизонт 1': { 'segyvol-x': pts(50) } }, false);
    expect(s.map((x) => x.id)).toEqual(['mA', 'seis:Горизонт 1']);
    expect(s[1].marker).toBeNull();
    expect(s[1].color).toBe(horizonColorFor('Горизонт 1', []));
  });

  it('keeps a пласт\'s own colour when it exists but is not mappable', () => {
    const s = mapSurfaces([], [topA, topB], { 'Top B': { A: pts(5) } }, false);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ id: 'seis:Top B', color: '#FF9500', marker: null });
  });

  it('skips a seismic label whose every line is empty', () => {
    const s = mapSurfaces([], [], { 'Top B': { A: [] } }, false);
    expect(s).toEqual([]);
  });

  it('adds nothing seismic in a schematic layout', () => {
    const s = mapSurfaces([], [], { 'Top B': { A: pts(5) } }, true);
    expect(s).toEqual([]);
  });
});

describe('mapExtentPoints', () => {
  it('is the wells alone when there is no seismic', () => {
    expect(mapExtentPoints([{ x: 1, y: 2 }], {}, false)).toEqual([{ x: 1, y: 2 }]);
  });

  it('folds in every seismic horizon on every line, not just one', () => {
    const e = mapExtentPoints([], { H1: { A: pts(2), B: pts(3) }, H2: { A: pts(1) } }, false);
    expect(e).toHaveLength(6);
  });

  it('drops non-finite seismic coordinates and ignores seismic when schematic', () => {
    const bad = [{ x: NaN, y: 0, z: 1 }, { x: 5, y: 5, z: 1 }];
    expect(mapExtentPoints([], { H: { A: bad } }, false)).toEqual([{ x: 5, y: 5 }]);
    expect(mapExtentPoints([{ x: 0, y: 0 }], { H: { A: bad } }, true)).toEqual([{ x: 0, y: 0 }]);
  });
});
