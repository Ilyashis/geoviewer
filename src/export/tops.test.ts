import { describe, it, expect } from 'vitest';
import { buildTopsCsv } from './tops';
import type { Marker, Well } from '../types';

const well = (id: string, name: string): Well => ({
  id, name, depth: [], depthUnit: 'M', curves: [], lithology: [], header: {},
});

describe('buildTopsCsv', () => {
  it('emits one row per pick, wells outer, markers inner', () => {
    const wells = [well('w1', 'UT-1058'), well('w2', 'UT-1059')];
    const markers: Marker[] = [
      { id: 'm1', label: 'Top A', color: '#000', depths: { w1: 2048, w2: 2055.2 } },
      { id: 'm2', label: 'KP S8', color: '#000', depths: { w1: 2096 } },
    ];
    expect(buildTopsCsv(markers, wells)).toBe(
      ['Well,Surface,MD', 'UT-1058,Top A,2048', 'UT-1058,KP S8,2096', 'UT-1059,Top A,2055.2'].join('\n')
    );
  });

  it('quotes fields containing a comma', () => {
    const wells = [well('w1', 'UT, north')];
    const markers: Marker[] = [{ id: 'm', label: 'Top, main', color: '#000', depths: { w1: 100 } }];
    expect(buildTopsCsv(markers, wells)).toBe('Well,Surface,MD\n"UT, north","Top, main",100');
  });

  it('skips wells without a pick for a marker', () => {
    const wells = [well('w1', 'A'), well('w2', 'B')];
    const markers: Marker[] = [{ id: 'm', label: 'T', color: '#000', depths: { w1: 10 } }];
    expect(buildTopsCsv(markers, wells)).toBe('Well,Surface,MD\nA,T,10');
  });
});
