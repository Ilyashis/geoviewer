import { describe, it, expect } from 'vitest';
import { buildSectionsCsv } from './sections';
import type { SectionLine } from '../store/slices/framework';

describe('buildSectionsCsv', () => {
  it('writes one row per polyline vertex', () => {
    const sections: SectionLine[] = [
      { id: 'section-1', label: 'Разрез 1', points: [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }] },
    ];
    const rows = buildSectionsCsv(sections).split('\n');
    expect(rows[0]).toBe('Section,Label,PointIndex,X,Y');
    expect(rows).toHaveLength(4); // header + 3 vertices
    expect(rows[1]).toBe('section-1,Разрез 1,0,10,20');
    expect(rows[2]).toBe('section-1,Разрез 1,1,30,40');
    expect(rows[3]).toBe('section-1,Разрез 1,2,50,60');
  });

  it('handles several lines back to back', () => {
    const sections: SectionLine[] = [
      { id: 'section-1', label: 'Разрез 1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { id: 'section-2', label: 'Разрез 2', points: [{ x: 5, y: 5 }, { x: 6, y: 6 }] },
    ];
    const rows = buildSectionsCsv(sections).split('\n');
    expect(rows).toHaveLength(5); // header + 2 + 2
    expect(rows[3]).toBe('section-2,Разрез 2,0,5,5');
  });

  it('quotes a label containing a comma', () => {
    const sections: SectionLine[] = [{ id: 'section-1', label: 'Разрез, боковой', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
    const rows = buildSectionsCsv(sections).split('\n');
    expect(rows[1]).toContain('"Разрез, боковой"');
  });

  it('is just a header line when there are no sections', () => {
    expect(buildSectionsCsv([])).toBe('Section,Label,PointIndex,X,Y');
  });
});
