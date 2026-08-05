import { describe, it, expect } from 'vitest';
import { parseTopsCsv } from './csv';

describe('parseTopsCsv', () => {
  it('parses a comma CSV with EN headers', () => {
    const csv = `Well,Surface,MD
UT-1058,Top A,2048.0
UT-1058,KP S8,2096.5
UT-1059,Top A,2055.2`;
    const { rows, columns } = parseTopsCsv(csv);
    expect(columns).toEqual({ well: 'Well', surface: 'Surface', depth: 'MD' });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ well: 'UT-1058', surface: 'Top A', depth: 2048 });
    expect(rows[1].surface).toBe('KP S8');
  });

  it('handles semicolon delimiter and RU headers with comma decimals', () => {
    const csv = `Скважина;Пласт;Глубина
UT-1058;Кровля П1;2048,5
UT-1059;Кровля П1;2055,2`;
    const { rows } = parseTopsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ well: 'UT-1058', surface: 'Кровля П1', depth: 2048.5 });
  });

  it('handles tab delimiter and quoted fields', () => {
    const csv = `well\ttop\tdepth
"UT 10, north"\t"Top, main"\t1500.25`;
    const { rows } = parseTopsCsv(csv);
    expect(rows[0]).toEqual({ well: 'UT 10, north', surface: 'Top, main', depth: 1500.25 });
  });

  it('skips rows with missing or non-numeric depth', () => {
    const csv = `Well,Surface,MD
UT-1,Top A,2000
UT-1,Top B,
UT-1,Top C,abc`;
    const { rows } = parseTopsCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it('throws with a helpful message when a column is missing', () => {
    const csv = `Name,Value\nfoo,1`;
    expect(() => parseTopsCsv(csv)).toThrow(/Не найдены колонки/);
  });
});
