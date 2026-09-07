import type { Marker } from '../types';
import type { ControlPoint } from '../core/framework';
import { horizonColorFor } from '../seismic/horizonColor';

/**
 * What the map can grid as a structure surface. Until seismic-only surfaces
 * existed this was just `Marker`; now it's either a well пласт (with the
 * seismic picks of the same label folded in) or a seismic horizon with no
 * mappable пласт behind it at all — a cube's «Горизонт N», a numbered pick
 * from an imported line, or a real пласт name picked on seismic in a project
 * that has too few wells with coordinates to map it from picks alone.
 */
export interface MapSurface {
  id: string;
  label: string;
  color: string;
  /** The well пласт behind this surface, or null for a seismic-only one. */
  marker: Marker | null;
}

export type SeismicHorizons = Record<string, Record<string, ControlPoint[]>>;

const SEISMIC_ID_PREFIX = 'seis:';

/**
 * Mappable well пласты first (their order is the picker's order), then every
 * seismic horizon label that no mappable пласт already covers. A label that
 * matches a mappable пласт is NOT listed twice — its picks already join that
 * пласт's surface via `seismicControls`. A label that matches a пласт which
 * exists but ISN'T mappable (fewer than three wells with coordinates carry
 * a pick) becomes a seismic-only surface, keeping the пласт's own colour.
 *
 * Nothing seismic when the layout is schematic: wells without coordinates
 * are drawn on a made-up grid, and real seismic coordinates on a made-up
 * grid would be a lie.
 */
export function mapSurfaces(mappable: Marker[], allMarkers: Marker[], seismic: SeismicHorizons, schematic: boolean): MapSurface[] {
  const out: MapSurface[] = mappable.map((m) => ({ id: m.id, label: m.label, color: m.color, marker: m }));
  if (schematic) return out;
  const covered = new Set(mappable.map((m) => m.label));
  const known = allMarkers.map((m) => ({ label: m.label, color: m.color }));
  for (const label of Object.keys(seismic)) {
    if (covered.has(label)) continue;
    const hasPoints = Object.values(seismic[label] ?? {}).some((pts) => pts.length > 0);
    if (!hasPoints) continue;
    out.push({ id: SEISMIC_ID_PREFIX + label, label, color: horizonColorFor(label, known), marker: null });
  }
  return out;
}

/** Every seismic control point saved under `label`, across all lines and
 * cubes, in the order stored. Depth as saved (TVDSS, positive down) — the
 * caller decides the sign convention of its own space. */
export function seismicPointsFor(seismic: SeismicHorizons, label: string): ControlPoint[] {
  return Object.values(seismic[label] ?? {}).flat();
}

/**
 * Every point the map should fit into view: well positions plus ALL seismic
 * horizon control points — not just the selected surface's, so switching
 * пласт doesn't re-fit the view, and not skipped when there are no wells,
 * which is exactly the case this exists for. Seismic points are ignored in a
 * schematic layout for the reason above.
 */
export function mapExtentPoints(wellPositions: { x: number; y: number }[], seismic: SeismicHorizons, schematic: boolean): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = wellPositions.map((p) => ({ x: p.x, y: p.y }));
  if (schematic) return out;
  for (const byLine of Object.values(seismic)) {
    for (const pts of Object.values(byLine)) {
      for (const c of pts) if (Number.isFinite(c.x) && Number.isFinite(c.y)) out.push({ x: c.x, y: c.y });
    }
  }
  return out;
}
