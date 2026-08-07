import { describe, it, expect } from 'vitest';
import { lengthUnitOf, toMetres, tvdss, DEFAULT_CRS } from './index';

describe('lengthUnitOf', () => {
  it('detects feet from common spellings, defaults to metres', () => {
    for (const ft of ['ft', 'FT', 'F', 'feet', "'"]) expect(lengthUnitOf(ft)).toBe('ft');
    for (const m of ['m', 'M', '', undefined, 'GAPI']) expect(lengthUnitOf(m)).toBe('m');
  });
});

describe('toMetres', () => {
  it('converts feet and leaves metres untouched', () => {
    expect(toMetres(1000, 'ft')).toBeCloseTo(304.8, 4);
    expect(toMetres(1000, 'm')).toBe(1000);
  });
});

describe('tvdss', () => {
  it('shifts TVD by the KB elevation; absent KB is a no-op', () => {
    expect(tvdss(2000, 30)).toBe(1970);
    expect(tvdss(2000)).toBe(2000);
    expect(tvdss(2000, undefined)).toBe(2000);
    expect(tvdss(2000, 0)).toBe(2000);
  });
});

describe('DEFAULT_CRS', () => {
  it('is local metres referenced to KB', () => {
    expect(DEFAULT_CRS).toEqual({ name: 'Локальная (метры)', lengthUnit: 'm', verticalDatum: 'KB' });
  });
});
