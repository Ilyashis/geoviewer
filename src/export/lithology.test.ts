import { describe, it, expect } from 'vitest';
import { buildLithologyCsv } from './lithology';
import type { Well } from '../types';

const well = (name: string, lithology: Well['lithology']): Well => ({
  id: name, name, depth: [], depthUnit: 'M', curves: [], lithology, header: {},
});

describe('buildLithologyCsv', () => {
  it('emits Well,Top,Base,Lithology,Saturation rows with preserved names', () => {
    const wells = [
      well('UT-1058', [
        { top: 2000, base: 2012, color: '#f00', pattern: 'dots', litho: 'Sandstone', satName: 'Oil' },
        { top: 2012, base: 2020, color: '#0f0', pattern: 'diag', litho: 'Shale' },
      ]),
    ];
    expect(buildLithologyCsv(wells)).toBe(
      [
        'Well,Top,Base,Lithology,Saturation',
        'UT-1058,2000,2012,Sandstone,Oil',
        'UT-1058,2012,2020,Shale,',
      ].join('\n')
    );
  });

  it('quotes names with commas and empties missing name', () => {
    const wells = [well('W', [{ top: 1, base: 2, color: '#000', pattern: 'solid', litho: 'A, B' }])];
    expect(buildLithologyCsv(wells)).toBe('Well,Top,Base,Lithology,Saturation\nW,1,2,"A, B",');
  });
});
