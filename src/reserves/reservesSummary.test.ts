import { describe, it, expect } from 'vitest';
import { summarizeZones, buildSummaryCsv, type SummaryOpts } from './reservesSummary';
import { DEFAULT_PETRO } from '../wells/petrophysics';
import type { Well, Marker } from '../types';

function well(id: string, x: number, y: number): Well {
  return { id, name: id, depth: [], depthUnit: 'M', lithology: [], header: {}, curves: [], x, y };
}
const wells: Well[] = [well('a', 0, 0), well('b', 1000, 0), well('c', 500, 800)];

function marker(id: string, label: string, depths: Record<string, number>): Marker {
  return { id, label, color: '#888', depths };
}
// Three tops → two consecutive zones. 'mid' listed first to prove depth ordering.
const markers: Marker[] = [
  marker('m2', 'Mid', { a: 2050, b: 2062, c: 2055 }),
  marker('m1', 'Top A', { a: 2000, b: 2010, c: 2005 }),
  marker('m3', 'Base', { a: 2100, b: 2115, c: 2108 }),
];

const opts: SummaryOpts = { manual: { ng: 0.5, phi: 0.2, sw: 0.25 }, bo: 1.25, rf: 0.3, useLogs: false, petro: DEFAULT_PETRO };

describe('summarizeZones', () => {
  it('builds consecutive zones ordered by depth and rolls up totals', () => {
    const s = summarizeZones(wells, markers, opts);
    expect(s.zones.map((z) => `${z.topLabel}–${z.baseLabel}`)).toEqual(['Top A–Mid', 'Mid–Base']);
    for (const z of s.zones) {
      expect(z.wells).toBe(3);
      expect(z.source).toBe('manual');
      expect(z.ng).toBeCloseTo(0.5, 6);
      expect(z.stooipBbl).toBeGreaterThan(0);
    }
    expect(s.totalStooipBbl).toBeCloseTo(s.zones[0].stooipBbl + s.zones[1].stooipBbl, 3);
    expect(s.totalRecoverableBbl).toBeCloseTo(s.totalStooipBbl * 0.3, 2);
  });

  it('returns no zones without enough wells', () => {
    expect(summarizeZones(wells.slice(0, 2), markers, opts).zones).toHaveLength(0);
  });
});

describe('buildSummaryCsv', () => {
  it('emits a header, a row per zone and a total', () => {
    const csv = buildSummaryCsv(summarizeZones(wells, markers, opts));
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Пласт,Скважин');
    expect(lines[1]).toContain('Top A–Mid,3');
    expect(lines).toHaveLength(4); // header + 2 zones + total
    expect(lines[3]).toMatch(/^ИТОГО,/);
  });
});
