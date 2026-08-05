import { describe, it, expect } from 'vitest';
import { parseLithologyCsv } from './csv';
import { mapLithology, mapSaturation } from './map';

describe('parseLithologyCsv', () => {
  it('parses EN headers with optional saturation', () => {
    const csv = `Well,Top,Base,Lithology,Saturation
UT-1058,2000,2012,Sandstone,Oil
UT-1058,2012,2020,Shale,`;
    const { rows, columns } = parseLithologyCsv(csv);
    expect(columns.sat).toBe('Saturation');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ well: 'UT-1058', top: 2000, base: 2012, litho: 'Sandstone', sat: 'Oil' });
    expect(rows[1].sat).toBeUndefined();
  });

  it('handles RU headers, semicolons and swapped top/base', () => {
    const csv = `Скважина;Кровля;Подошва;Литотип
UT-1;2050;2040;Песчаник`;
    const { rows } = parseLithologyCsv(csv);
    expect(rows[0]).toEqual({ well: 'UT-1', top: 2040, base: 2050, litho: 'Песчаник' });
  });

  it('throws when lithology column is missing', () => {
    expect(() => parseLithologyCsv('Well,Top,Base\nA,1,2')).toThrow(/Не найдены колонки/);
  });
});

describe('lithology mapping', () => {
  it('maps known RU/EN lithologies', () => {
    expect(mapLithology('Sandstone').color).toBe('#F0D264');
    expect(mapLithology('Песчаник').color).toBe('#F0D264');
    expect(mapLithology('Известняк').color).toBe('#A7F0BA');
  });

  it('falls back deterministically for unknown types', () => {
    expect(mapLithology('Zorbonite')).toEqual(mapLithology('Zorbonite'));
    expect(mapLithology('Zorbonite').color).toMatch(/^hsl\(/);
  });

  it('maps saturation names, undefined when unknown', () => {
    expect(mapSaturation('Oil')).toBe('#F44336');
    expect(mapSaturation('вода')).toBe('#B8E2FC');
    expect(mapSaturation('xyz')).toBeUndefined();
    expect(mapSaturation(undefined)).toBeUndefined();
  });
});
