import { describe, it, expect } from 'vitest';
import { parseHeaderLine, parseLas, parseLasToWell } from './parser';

// A compact but realistic LAS 2.0 sample (based on the CWLS example format).
const SAMPLE = `~Version Information
 VERS.                 2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0
 WRAP.                  NO : ONE LINE PER DEPTH STEP
~Well Information
#MNEM.UNIT       DATA         DESCRIPTION
 STRT.M        1670.000000 : START DEPTH
 STOP.M        1669.750000 : STOP DEPTH
 STEP.M          -0.125000 : STEP
 NULL.           -999.2500 : NULL VALUE
 WELL.        ANDROMEDA-1  : WELL
 UWI .        100/01-01    : UNIQUE WELL ID
~Curve Information
 DEPT.M                    : 1  DEPTH
 GR  .GAPI                 : 2  GAMMA RAY
 RESD.OHMM                 : 3  DEEP RESISTIVITY
~ASCII
1670.000000   75.250   12.500
1669.875000   82.100   -999.2500
1669.750000   68.300   15.100
`;

describe('parseHeaderLine', () => {
  it('splits mnemonic, unit, value and description', () => {
    const item = parseHeaderLine('STRT.M        1670.000000 : START DEPTH');
    expect(item).toEqual({
      mnemonic: 'STRT',
      unit: 'M',
      value: '1670.000000',
      description: 'START DEPTH',
    });
  });

  it('handles a curve line with no value', () => {
    const item = parseHeaderLine(' GR  .GAPI                 : 2  GAMMA RAY');
    expect(item?.mnemonic).toBe('GR');
    expect(item?.unit).toBe('GAPI');
    expect(item?.value).toBe('');
    expect(item?.description).toBe('2  GAMMA RAY');
  });

  it('handles unit with no value and no description', () => {
    const item = parseHeaderLine(' DEPT.M');
    expect(item?.mnemonic).toBe('DEPT');
    expect(item?.unit).toBe('M');
  });
});

describe('parseLas', () => {
  it('reads version, well and curve sections', () => {
    const p = parseLas(SAMPLE);
    expect(p.wrap).toBe(false);
    expect(p.nullValue).toBe(-999.25);
    expect(p.well['WELL'].value).toBe('ANDROMEDA-1');
    expect(p.curveInfo.map((c) => c.mnemonic)).toEqual(['DEPT', 'GR', 'RESD']);
  });

  it('builds a column-major data matrix', () => {
    const p = parseLas(SAMPLE);
    expect(p.data).toHaveLength(3);
    expect(p.data[0]).toEqual([1670.0, 1669.875, 1669.75]);
    expect(p.data[1]).toEqual([75.25, 82.1, 68.3]);
  });
});

describe('parseLasToWell', () => {
  it('maps to a Well with NULL values converted to null', () => {
    const well = parseLasToWell(SAMPLE, 'andromeda.las');
    expect(well.name).toBe('ANDROMEDA-1');
    expect(well.uwi).toBe('100/01-01');
    expect(well.depthUnit).toBe('M');
    expect(well.depth).toEqual([1670.0, 1669.875, 1669.75]);

    const resd = well.curves.find((c) => c.mnemonic === 'RESD')!;
    expect(resd.values).toEqual([12.5, null, 15.1]);
    expect(resd.unit).toBe('OHMM');
  });
});

describe('WRAP=YES handling', () => {
  const WRAPPED = `~Version
 VERS. 2.0 :
 WRAP. YES :
~Well
 NULL. -999.25 :
 WELL. WRAPTEST :
~Curve
 DEPT.M :
 GR.GAPI :
 RESD.OHMM :
~ASCII
1670.000000
   75.250   12.500
1669.875000
   82.100   14.100
`;

  it('reconstructs rows across wrapped lines', () => {
    const well = parseLasToWell(WRAPPED);
    expect(well.depth).toEqual([1670.0, 1669.875]);
    const gr = well.curves.find((c) => c.mnemonic === 'GR')!;
    expect(gr.values).toEqual([75.25, 82.1]);
  });
});

describe('real-world robustness', () => {
  const base = (data: string, depthUnit = 'M') => `~V
 VERS. 2.0 :
 WRAP. NO :
~W
 NULL. -999.25 :
 WELL. RW :
~C
 DEPT.${depthUnit} :
 GR.GAPI :
 RESD.OHMM :
~A
${data}`;

  it('converts a feet depth index to metres', () => {
    const well = parseLasToWell(base('1000 75 12\n1000.5 80 13', 'FT'));
    expect(well.depthUnit).toBe('M');
    expect(well.depth[0]).toBeCloseTo(304.8, 4);
    expect(well.depth[1]).toBeCloseTo(304.9524, 4);
  });

  it('keeps rows aligned when a data line is short (WRAP=NO)', () => {
    const well = parseLasToWell(base('1670 75 12\n1669 82\n1668 68 15'));
    expect(well.depth).toEqual([1670, 1669, 1668]);
    const resd = well.curves.find((c) => c.mnemonic === 'RESD')!;
    expect(resd.values).toEqual([12, null, 15]); // missing value → null, later rows unshifted
  });

  it('accepts comma-delimited data', () => {
    const well = parseLasToWell(base('1670.0,75.25,12.5\n1669.0,82.1,14.1'));
    expect(well.depth).toEqual([1670.0, 1669.0]);
    expect(well.curves.find((c) => c.mnemonic === 'GR')!.values).toEqual([75.25, 82.1]);
  });

  it('tolerates a leading BOM', () => {
    const p = parseLas('﻿' + base('1670 75 12'));
    expect(p.curveInfo.map((c) => c.mnemonic)).toEqual(['DEPT', 'GR', 'RESD']);
    expect(p.well['WELL'].value).toBe('RW');
  });

  it('throws when the ~ASCII section has no rows', () => {
    expect(() => parseLasToWell(base(''))).toThrow(/нет строк данных/);
  });
});

describe('surface coordinates', () => {
  const withWell = (wellLines: string) => `~V
 VERS. 2.0 :
 WRAP. NO :
~W
 NULL. -999.25 :
 WELL. RW :
${wellLines}
~C
 DEPT.M :
 GR.GAPI :
~A
1670 75`;

  it('takes projected coordinates as metres', () => {
    const w = parseLasToWell(withWell(' XCOORD.M 512340 :\n YCOORD.M 6194500 :'));
    expect([w.x, w.y]).toEqual([512340, 6194500]);
    expect(w.geodetic).toBeUndefined();
  });

  it('falls back to lon/lat and flags them as degrees', () => {
    const w = parseLasToWell(withWell(' LONG.DEG 60.25 :\n LATI.DEG 55.75 :'));
    expect([w.x, w.y]).toEqual([60.25, 55.75]);
    expect(w.geodetic).toBe(true);
  });

  it('prefers projected over geographic when the file carries both', () => {
    // Geographic listed FIRST — header order must not decide which pair wins,
    // and the two must never be mixed (easting with latitude).
    const w = parseLasToWell(withWell(' LONG.DEG 60.25 :\n LATI.DEG 55.75 :\n XCOORD.M 512340 :\n YCOORD.M 6194500 :'));
    expect([w.x, w.y]).toEqual([512340, 6194500]);
    expect(w.geodetic).toBeUndefined();
  });

  it('ignores a half-present projected pair rather than mixing frames', () => {
    const w = parseLasToWell(withWell(' XCOORD.M 512340 :\n LONG.DEG 60.25 :\n LATI.DEG 55.75 :'));
    expect([w.x, w.y]).toEqual([60.25, 55.75]); // complete geographic pair, not X + latitude
    expect(w.geodetic).toBe(true);
  });
});

describe('KB / depth-reference elevation', () => {
  const withWellSection = (wellLines: string) => `~V
 VERS. 2.0 :
 WRAP. NO :
~W
 NULL. -999.25 :
 WELL. RW :
${wellLines}
~C
 DEPT.M :
 GR.GAPI :
~A
1670 75`;

  it('reads EKB as the depth reference', () => {
    expect(parseLasToWell(withWellSection(' EKB.M 142.5 : Elevation KB')).kb).toBeCloseTo(142.5, 6);
  });

  it('converts a KB given in feet to metres', () => {
    expect(parseLasToWell(withWellSection(' EKB.FT 100 : Elevation KB')).kb).toBeCloseTo(30.48, 6);
  });

  it('prefers the explicit KB mnemonic over a generic elevation', () => {
    const well = parseLasToWell(withWellSection(' ELEV.M 90 :\n EKB.M 142.5 :'));
    expect(well.kb).toBeCloseTo(142.5, 6); // EKB names the logging datum, ELEV doesn't
  });

  it('falls back to ELEV when no drilling-reference mnemonic is present', () => {
    expect(parseLasToWell(withWellSection(' ELEV.M 90 :')).kb).toBeCloseTo(90, 6);
  });

  it('leaves kb undefined when the header has no elevation (TVDSS falls back to TVD)', () => {
    expect(parseLasToWell(withWellSection(' UWI. 100/DEMO :')).kb).toBeUndefined();
  });

  it('ignores a non-numeric elevation instead of yielding NaN depths', () => {
    expect(parseLasToWell(withWellSection(' EKB.M UNKNOWN :')).kb).toBeUndefined();
  });
});

describe('LAS 3.0', () => {
  const v3 = (dlm: string, data: string) => `~Version
 VERS. 3.0 :
 WRAP. NO :
 DLM . ${dlm} :
~Well
 NULL. -999.25 :
 WELL. LAS3 :
~Curve
 DEPT   .M    : DEPTH
 RHOZC[0].G/CC : AZD Corrected Density
 RHOZC[1].G/CC : AZD Corrected Density
~ASCII
${data}`;

  it('разбирает секции 3.0 и массивные мнемоники', () => {
    const w = parseLasToWell(v3('SPACE', '3400.0 2.414 2.457\n3400.1 2.422 2.472'));
    expect(w.name).toBe('LAS3');
    expect(w.curves.map((c) => c.mnemonic)).toEqual(['RHOZC[0]', 'RHOZC[1]']);
    expect(w.depth).toEqual([3400.0, 3400.1]);
  });

  it('не сдвигает колонки, когда при DLM COMMA значение пропущено', () => {
    // `3400.0,,2.457` — вторая кривая без замера. Схлопывание разделителей
    // сдвинуло бы 2.457 в RHOZC[0], то есть выдало бы чужую кривую за свою.
    const w = parseLasToWell(v3('COMMA', '3400.0,,2.457\n3400.1,2.422,2.472'));
    expect(w.curves.find((c) => c.mnemonic === 'RHOZC[0]')!.values).toEqual([null, 2.422]);
    expect(w.curves.find((c) => c.mnemonic === 'RHOZC[1]')!.values).toEqual([2.457, 2.472]);
  });

  it('читает объявленный TAB как разделитель', () => {
    const w = parseLasToWell(v3('TAB', '3400.0\t\t2.457'));
    expect(w.curves.find((c) => c.mnemonic === 'RHOZC[0]')!.values).toEqual([null]);
    expect(w.curves.find((c) => c.mnemonic === 'RHOZC[1]')!.values).toEqual([2.457]);
  });
});

describe('нестандартная раскладка ~Well', () => {
  const inverted = `~V
 VERS. 2.0 :
 WRAP. NO :
~W
 NULL.  -999.25 :
 WELL.                    WELL: 22R
 UWI .                     UWI: 256_22R
~C
 DEPT.M :
 GR.GAPI :
~A
1670 75`;

  it('берёт имя из описания, когда значение дублирует мнемонику', () => {
    // Реальный файл пишет «WELL. WELL: 22R» — имя справа от двоеточия.
    const w = parseLasToWell(inverted, '22R_CGR.las');
    expect(w.name).toBe('22R');
    expect(w.uwi).toBe('256_22R');
  });

  it('не ломает обычную раскладку', () => {
    const normal = inverted.replace(' WELL.                    WELL: 22R', ' WELL.  2029 : 2029 куст 11');
    expect(parseLasToWell(normal, 'x.las').name).toBe('2029');
  });
});
