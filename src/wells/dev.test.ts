import { describe, it, expect } from 'vitest';
import { parseDev } from './dev';

/** Shape of a Petrel `.dev` export, trimmed to what the parser reads. */
const file = (rows: string) => `# WELL TRACE FROM PETREL
# WELL NAME:              П-1
# WELL HEAD X-COORDINATE: 328818.61000000 (m)
# WELL HEAD Y-COORDINATE: 3818409.01000000 (m)
# WELL DATUM (KB, Kelly bushing, from MSL): 7.60000000 (m)
# MD AND TVD ARE REFERENCED (=0) AT WELL DATUM AND INCREASE DOWNWARDS
# ANGLES ARE NOT EXACT (TRACE WAS NOT IMPORTED USING ANGLES)
#================================================================
      MD            X            Y            Z           TVD           DX          DY          AZIM         INCL         DLS
#================================================================
${rows}`;

describe('parseDev', () => {
  it('reads the wellhead and KB out of the comment header', () => {
    const d = parseDev(file(' 0.0 328818.61 3818409.01 7.6 0.0 0 0 0 0 0'));
    expect(d.well).toBe('П-1');
    expect(d.x).toBeCloseTo(328818.61, 4);
    expect(d.y).toBeCloseTo(3818409.01, 4);
    expect(d.kb).toBeCloseTo(7.6, 6);
  });

  it('treats a plain vertical stub as carrying no trajectory', () => {
    // Exactly the shape of the real export: two rows, X/Y constant.
    const d = parseDev(file(
      ' 0.0 328818.61 3818409.01 7.6 0.0 0 0 0 0 0\n' +
      ' 3005.0 328818.61 3818409.01 -2997.4 3005.0 0 0 0 0 0',
    ));
    expect(d.deviated).toBe(false);
    expect(d.survey).toEqual([]); // nothing worth storing — MD already equals TVD
  });

  it('derives inclination and azimuth from the XYZ trace, not the angle columns', () => {
    // A 45° step due east: 100 m down, 100 m east. The AZIM/INCL columns are
    // deliberately left at 0, as Petrel writes them when it has no angle data.
    const d = parseDev(file(
      ' 0.0   1000.0 2000.0  10.0    0.0 0 0 0 0 0\n' +
      ' 141.4 1100.0 2000.0 -90.0  141.4 0 0 0 0 0',
    ));
    expect(d.deviated).toBe(true);
    expect(d.survey).toHaveLength(2);
    expect(d.survey[1].inc).toBeCloseTo(45, 1);
    expect(d.survey[1].azi).toBeCloseTo(90, 1); // east
  });

  it('reads azimuth due north as 0°', () => {
    const d = parseDev(file(
      ' 0.0   1000.0 2000.0  10.0   0.0 0 0 0 0 0\n' +
      ' 141.4 1000.0 2100.0 -90.0 141.4 0 0 0 0 0',
    ));
    expect(d.survey[1].azi).toBeCloseTo(0, 1);
  });

  it('falls back to the file name when the header has no well name', () => {
    const d = parseDev('#================\n MD X Y Z\n 0 1 2 3', '216.dev');
    expect(d.well).toBe('216');
  });
});
