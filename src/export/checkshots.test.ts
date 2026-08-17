import { describe, it, expect } from 'vitest';
import { buildCheckshotsCsv } from './checkshots';
import type { WellCheckshot } from '../wells/checkshot';

describe('buildCheckshotsCsv', () => {
  it('writes one row per measured time-depth pair', () => {
    const checkshots: WellCheckshot[] = [
      { well: 'UT-1058', points: [{ md: 100, tvdss: -92, twt: 80 }, { md: 200, tvdss: -190, twt: 165 }] },
    ];
    const rows = buildCheckshotsCsv(checkshots).split('\n');
    expect(rows[0]).toBe('Well,MD,TVDSS,TWT');
    expect(rows).toHaveLength(3); // header + 2 pairs
    expect(rows[1]).toBe('UT-1058,100,-92,80');
    expect(rows[2]).toBe('UT-1058,200,-190,165');
  });

  it('handles several wells back to back', () => {
    const checkshots: WellCheckshot[] = [
      { well: 'UT-1058', points: [{ md: 100, tvdss: -92, twt: 80 }] },
      { well: 'UT-1059', points: [{ md: 150, tvdss: -140, twt: 120 }] },
    ];
    const rows = buildCheckshotsCsv(checkshots).split('\n');
    expect(rows).toHaveLength(3); // header + 1 + 1
    expect(rows[2]).toBe('UT-1059,150,-140,120');
  });

  it('quotes a well name containing a comma', () => {
    const checkshots: WellCheckshot[] = [{ well: 'UT-1058, ствол 2', points: [{ md: 100, tvdss: -92, twt: 80 }] }];
    const rows = buildCheckshotsCsv(checkshots).split('\n');
    expect(rows[1]).toContain('"UT-1058, ствол 2"');
  });

  it('is just a header line when there are no checkshots', () => {
    expect(buildCheckshotsCsv([])).toBe('Well,MD,TVDSS,TWT');
  });
});
