import type { Well, Marker } from '../types';
import { idwGrid } from './grid';
import { volumetrics } from './volumetrics';
import { aggregateZone, type PetroParams } from './petrophysics';

export interface ZoneReserve {
  topLabel: string;
  baseLabel: string;
  wells: number;
  areaKm2: number;
  meanThickness: number;
  ng: number;
  phi: number;
  sw: number;
  source: 'logs' | 'manual';
  grossM3: number;
  stooipM3: number;
  stooipBbl: number;
  recoverableBbl: number;
}

export interface FieldSummary {
  zones: ZoneReserve[];
  totalGrossM3: number;
  totalStooipM3: number;
  totalStooipBbl: number;
  totalRecoverableBbl: number;
}

export interface SummaryOpts {
  manual: { ng: number; phi: number; sw: number };
  bo: number;
  rf: number;
  useLogs: boolean;
  petro: PetroParams;
}

/** Mean pick depth of a marker over the given wells (Infinity if unpicked). */
function meanPick(m: Marker, wells: Well[]): number {
  let s = 0, n = 0;
  for (const w of wells) { const d = m.depths[w.id]; if (Number.isFinite(d)) { s += d; n++; } }
  return n ? s / n : Infinity;
}

/**
 * Reserves for every consecutive pay zone (adjacent tops, ordered by depth):
 * grid each isochore on a shared mesh, take N/G·φ·Sw from logs (per zone) or the
 * manual set, and roll up field totals. OWC is not applied here (whole-area).
 */
export function summarizeZones(coordWells: Well[], markers: Marker[], opts: SummaryOpts): FieldSummary {
  const zones: ZoneReserve[] = [];

  if (coordWells.length >= 3 && markers.length >= 2) {
    // Shared bounds matching the map (12% pad, nx=130) so per-zone numbers align.
    const xs = coordWells.map((w) => w.x!), ys = coordWells.map((w) => w.y!);
    const minXr = Math.min(...xs), maxXr = Math.max(...xs), minYr = Math.min(...ys), maxYr = Math.max(...ys);
    const padX = (maxXr - minXr) * 0.12 || 100, padY = (maxYr - minYr) * 0.12 || 100;
    const minX = minXr - padX, maxX = maxXr + padX, minY = minYr - padY, maxY = maxYr + padY;
    const nx = 130, ny = Math.max(20, Math.round(130 * ((maxY - minY) / (maxX - minX))));

    const ordered = [...markers].sort((a, b) => meanPick(a, coordWells) - meanPick(b, coordWells));
    for (let i = 0; i + 1 < ordered.length; i++) {
      const top = ordered[i], base = ordered[i + 1];
      const points: { x: number; y: number; z: number }[] = [];
      for (const w of coordWells) {
        const t = top.depths[w.id], b = base.depths[w.id];
        if (Number.isFinite(t) && Number.isFinite(b) && b > t) points.push({ x: w.x!, y: w.y!, z: b - t });
      }
      if (points.length < 3) continue;

      const grid = idwGrid(points, minX, maxX, minY, maxY, nx, ny);
      const logAgg = opts.useLogs
        ? aggregateZone(coordWells, (w) => top.depths[w.id], (w) => base.depths[w.id], opts.petro)
        : null;
      const p = logAgg ? { ng: logAgg.ng, phi: logAgg.phi, sw: logAgg.sw } : opts.manual;
      const vr = volumetrics(grid, { ...p, bo: opts.bo, rf: opts.rf });

      zones.push({
        topLabel: top.label, baseLabel: base.label, wells: points.length,
        areaKm2: vr.areaKm2, meanThickness: vr.meanThickness,
        ng: p.ng, phi: p.phi, sw: p.sw, source: logAgg ? 'logs' : 'manual',
        grossM3: vr.grossM3, stooipM3: vr.stooipM3, stooipBbl: vr.stooipBbl, recoverableBbl: vr.recoverableBbl,
      });
    }
  }

  return {
    zones,
    totalGrossM3: zones.reduce((s, z) => s + z.grossM3, 0),
    totalStooipM3: zones.reduce((s, z) => s + z.stooipM3, 0),
    totalStooipBbl: zones.reduce((s, z) => s + z.stooipBbl, 0),
    totalRecoverableBbl: zones.reduce((s, z) => s + z.recoverableBbl, 0),
  };
}

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const trim = (x: number, d: number) => String(Number(x.toFixed(d)));
const int = (x: number) => String(Math.round(x));

/** Multi-zone reserves summary as CSV (one row per zone + a field total). */
export function buildSummaryCsv(s: FieldSummary): string {
  const rows = ['Пласт,Скважин,Площадь км²,Ср.толщина м,N/G,φ,Sw,Источник,STOOIP барр,Извлекаемые барр'];
  for (const z of s.zones) {
    rows.push([
      esc(`${z.topLabel}–${z.baseLabel}`), z.wells, trim(z.areaKm2, 3), trim(z.meanThickness, 1),
      trim(z.ng, 3), trim(z.phi, 3), trim(z.sw, 3), z.source === 'logs' ? 'логи' : 'ручные',
      int(z.stooipBbl), int(z.recoverableBbl),
    ].join(','));
  }
  rows.push(`ИТОГО,,,,,,,,${int(s.totalStooipBbl)},${int(s.totalRecoverableBbl)}`);
  return rows.join('\n');
}
