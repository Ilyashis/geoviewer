import type { Marker, Well } from '../types';
import type { ControlPoint } from '../core/geom/grid';
import { tvdss } from '../core/crs';
import { positionAtMd, tvdAtMd, type TrajPoint } from './deviation';

/**
 * Well-pick → structural point, the step every consumer of `buildSurface`
 * needs first: the map, the 3D scene, the cross-section, and the seismic
 * section's fault marks. Split out once a third call site needed it
 * (previously duplicated verbatim in `WellMap` and `CrossSectionView`).
 */

export function tvdssAt(trajs: Map<string, TrajPoint[]>, w: Well, md: number): number {
  return tvdss(tvdAtMd(trajs.get(w.id) ?? [], md), w.kb);
}

export function posAt(trajs: Map<string, TrajPoint[]>, w: Well, md: number): { x: number; y: number } {
  const p = positionAtMd(trajs.get(w.id) ?? [], md);
  return { x: w.x! + p.east, y: w.y! + p.north };
}

/**
 * Structural control points for a marker across a well set, independent of
 * whatever's currently on screen — a fault's throw or a horizon's shape is a
 * property of the picks, not of which tab happens to be open.
 */
export function structuralControlPoints(marker: Marker, coordWells: Well[], trajs: Map<string, TrajPoint[]>): ControlPoint[] {
  const points: ControlPoint[] = [];
  for (const w of coordWells) {
    const md = marker.depths[w.id];
    if (!Number.isFinite(md)) continue;
    const pos = posAt(trajs, w, md);
    points.push({ x: pos.x, y: pos.y, z: tvdssAt(trajs, w, md) });
  }
  return points;
}
