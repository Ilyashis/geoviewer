import { describe, it, expect } from 'vitest';
import { parseWellHeadsCsv } from './heads';

describe('parseWellHeadsCsv', () => {
  it('reads a tab-separated table with extra trailing columns', () => {
    // The shape Petrel-adjacent projects export: tabs, a TD column and an
    // unrelated trailing column that must not be mistaken for KB.
    const text = [
      'Well\tX\tY\tKB\tTD (MD)\tUncertainty standard deviation factor',
      '100\t328000.10\t3818000.20\t7.6\t3005\t-999',
      '102\t325000.75\t3814000.60\t21.5\t3300\t-999',
    ].join('\n');
    const p = parseWellHeadsCsv(text);
    expect(p.columns).toEqual({ well: 'Well', x: 'X', y: 'Y', kb: 'KB' });
    expect(p.rows).toEqual([
      { well: '100', x: 328000.10, y: 3818000.20, kb: 7.6 },
      { well: '102', x: 325000.75, y: 3814000.60, kb: 21.5 },
    ]);
  });

  it('treats producer null sentinels as missing rather than a real elevation', () => {
    const text = 'Well,X,Y,KB\nA,100,200,-999\nB,300,400,12.5';
    const p = parseWellHeadsCsv(text);
    expect(p.rows[0].kb).toBeUndefined(); // NOT -999 m below sea level
    expect(p.rows[1].kb).toBe(12.5);
  });

  it('accepts RU headers and a decimal comma', () => {
    const text = 'Скважина;X;Y;Альтитуда\nП-1;100,5;200,25;15,3';
    const p = parseWellHeadsCsv(text);
    expect(p.rows).toEqual([{ well: 'П-1', x: 100.5, y: 200.25, kb: 15.3 }]);
  });

  it('works without a KB column', () => {
    const p = parseWellHeadsCsv('Well,Easting,Northing\nA,100,200');
    expect(p.columns.kb).toBeUndefined();
    expect(p.rows).toEqual([{ well: 'A', x: 100, y: 200, kb: undefined }]);
  });

  it('skips rows with no usable position', () => {
    const p = parseWellHeadsCsv('Well,X,Y\nA,,\nB,100,200\nC,-999,-999');
    expect(p.rows.map((r) => r.well)).toEqual(['B']);
  });

  it('names the missing columns when the table is unusable', () => {
    expect(() => parseWellHeadsCsv('Скважина,Пласт\nA,Top')).toThrow(/Не найдены колонки:.*X.*Y/);
  });
});
