import type { Pt } from './polygon';

/**
 * Manual georeferencing for data whose own coordinates aren't in the
 * project's CRS (an imported SEG-Y line with no CRS in its header, the
 * documented real case this exists for — see docs/product/overview.md).
 * No projection library can fix that: the fix is asking the interpreter
 * for two points they actually know the real position of, and fitting the
 * rigid transform (translate + rotate + uniform scale) those two points
 * imply. Two points is also all two point pairs can honestly determine —
 * a third degree of freedom (shear) isn't recoverable from just two ties.
 */
export interface TiePoint {
  /** The point's coordinate as recorded in the data's own, unknown frame. */
  local: Pt;
  /** Where that same point really is, in the project's CRS. */
  map: Pt;
}

export interface Similarity {
  originLocal: Pt;
  originMap: Pt;
  scale: number;
  cos: number;
  sin: number;
}

/** Fit a similarity transform from two tie points. Null if they coincide in
 * the local frame — nothing to derive a rotation or scale from. */
export function fitSimilarity(a: TiePoint, b: TiePoint): Similarity | null {
  const dLocal = { x: b.local.x - a.local.x, y: b.local.y - a.local.y };
  const dMap = { x: b.map.x - a.map.x, y: b.map.y - a.map.y };
  const lenLocal = Math.hypot(dLocal.x, dLocal.y);
  if (lenLocal < 1e-9) return null;
  const lenMap = Math.hypot(dMap.x, dMap.y);
  const rot = Math.atan2(dMap.y, dMap.x) - Math.atan2(dLocal.y, dLocal.x);
  return { originLocal: a.local, originMap: a.map, scale: lenMap / lenLocal, cos: Math.cos(rot), sin: Math.sin(rot) };
}

/** Map a point from the local frame into the project's CRS via a fitted transform. */
export function applySimilarity(s: Similarity, p: Pt): Pt {
  const dx = p.x - s.originLocal.x, dy = p.y - s.originLocal.y;
  const rx = dx * s.cos - dy * s.sin, ry = dx * s.sin + dy * s.cos;
  return { x: s.originMap.x + rx * s.scale, y: s.originMap.y + ry * s.scale };
}
