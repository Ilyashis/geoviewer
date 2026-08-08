import { describe, it, expect } from 'vitest';
import { parsePetrelTops, isPetrelTops } from './petrel';

const V2 = `#Petrel Well Tops
VERSION 2
BEGIN HEADER
X
Y
Z
MD
Type
Surface Name
Well Name
Interpreter
END HEADER
 463360.60 7056808.07 -2478.35 2646.20 HORIZON "БС8-1_TOP_S" "1003" ""
 463360.60 7056808.07 -2486.15 2654.00 HORIZON "БС8-1_BOT_S" "1003" ""
 470000.00 7050000.00 -2500.00 2700.00 HORIZON "БС8-1_TOP_S" "2029" ""`;

const V1 = `#Petrel\tWell Tops
VERSION\t1
BEGIN HEADER
STRING Horizon Name
STRING Well Name
REAL Measured Depth
END HEADER
P4_Kr\t10R\t1308.0
P4_Pd\t10R\t1352.3
P5_Kr\t11R\t1400.5`;

describe('isPetrelTops', () => {
  it('recognises both dialects and rejects a plain CSV', () => {
    expect(isPetrelTops(V2)).toBe(true);
    expect(isPetrelTops(V1)).toBe(true);
    expect(isPetrelTops('Well,Surface,MD\n100,Top A,2048')).toBe(false);
  });
});

describe('parsePetrelTops — VERSION 2 (quoted, whitespace-separated)', () => {
  it('maps quoted names and MD, keeping Cyrillic surfaces intact', () => {
    const p = parsePetrelTops(V2);
    expect(p.rows).toEqual([
      { well: '1003', surface: 'БС8-1_TOP_S', depth: 2646.2 },
      { well: '1003', surface: 'БС8-1_BOT_S', depth: 2654.0 },
      { well: '2029', surface: 'БС8-1_TOP_S', depth: 2700.0 },
    ]);
    expect(p.wells).toBe(2);
    expect(p.surfaces).toBe(2);
  });

  it('picks up the wellhead coordinates the file carries', () => {
    const p = parsePetrelTops(V2);
    expect(p.heads).toEqual([
      { well: '1003', x: 463360.6, y: 7056808.07 },
      { well: '2029', x: 470000, y: 7050000 },
    ]);
  });
});

describe('parsePetrelTops — VERSION 1 (typed header, tab-separated)', () => {
  it('strips the STRING/REAL type keywords to find the columns', () => {
    const p = parsePetrelTops(V1);
    expect(p.rows).toEqual([
      { well: '10R', surface: 'P4_Kr', depth: 1308.0 },
      { well: '10R', surface: 'P4_Pd', depth: 1352.3 },
      { well: '11R', surface: 'P5_Kr', depth: 1400.5 },
    ]);
  });

  it('has no coordinates to offer when the file has no X/Y', () => {
    expect(parsePetrelTops(V1).heads).toEqual([]);
  });
});

describe('parsePetrelTops — robustness', () => {
  it('names the missing columns rather than failing silently', () => {
    const bad = 'BEGIN HEADER\nX\nY\nWell Tops\nEND HEADER\n1 2 3';
    expect(() => parsePetrelTops(bad)).toThrow(/нет колонок/);
  });

  it('rejects a file without the header block', () => {
    expect(() => parsePetrelTops('Well,Surface,MD\n100,Top,2048')).toThrow(/BEGIN HEADER/);
  });

  it('skips comment and blank rows in the data section', () => {
    const p = parsePetrelTops(V1 + '\n\n# комментарий\nP6_Kr\t12R\t1500.0');
    expect(p.rows).toHaveLength(4);
    expect(p.rows[3]).toEqual({ well: '12R', surface: 'P6_Kr', depth: 1500.0 });
  });
});
