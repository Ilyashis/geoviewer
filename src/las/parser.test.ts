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
