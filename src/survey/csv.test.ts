import { describe, it, expect } from 'vitest';
import { parseSurveyCsv } from './csv';

describe('parseSurveyCsv', () => {
  it('parses well/MD/INC/AZI with EN headers and comma decimals', () => {
    const csv = 'Well,MD,Inc,Azi\nUT-1,0,0,120\nUT-1,1600,0,120\nUT-1,2200,"34,5",120';
    const { rows, columns } = parseSurveyCsv(csv);
    expect(columns).toEqual({ well: 'Well', md: 'MD', inc: 'Inc', azi: 'Azi' });
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual({ well: 'UT-1', md: 2200, inc: 34.5, azi: 120 });
  });

  it('detects RU synonyms and a semicolon delimiter', () => {
    const csv = 'Скважина;Глубина;Зенит;Азимут\nP-2;0;0;0\nP-2;2000;15;90';
    const { rows, columns } = parseSurveyCsv(csv);
    expect(columns.well).toBe('Скважина');
    expect(columns.inc).toBe('Зенит');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ well: 'P-2', md: 2000, inc: 15, azi: 90 });
  });

  it('skips rows with missing or non-numeric fields', () => {
    const csv = 'Well,MD,Inc,Azi\nA,100,0,0\n,200,0,0\nA,,0,0\nA,300,x,0';
    expect(parseSurveyCsv(csv).rows).toHaveLength(1);
  });

  it('throws a helpful error when a required column is absent', () => {
    expect(() => parseSurveyCsv('Well,MD,Azi\nA,100,0')).toThrow(/наклон/);
  });
});
