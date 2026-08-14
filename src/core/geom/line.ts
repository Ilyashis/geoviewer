/**
 * Polyline geometry for the cross-section tool: where a well sits relative to
 * a user-drawn line (how far along it, how far off it), and how to walk the
 * line at a fixed step for sampling the structural grid continuously.
 */

import type { Pt } from './polygon';

export interface Projection {
  /** Distance along the polyline to the closest point, metres. */
  arc: number;
  /** Perpendicular distance from the polyline to the point, metres. */
  perp: number;
}

/** Total length of a polyline (0 for fewer than two vertices). */
export function polylineLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/**
 * Where `p` falls against a polyline: arc-length of its closest point (for
 * placing it along a cross-section) and the perpendicular distance to that
 * point (for deciding whether it's close enough to include at all). Checks
 * every segment rather than assuming the line is straight — a section drawn
 * with a bend must still place wells correctly on either side of it.
 */
export function projectOntoPolyline(p: Pt, pts: Pt[]): Projection {
  if (pts.length === 0) return { arc: 0, perp: Infinity };
  if (pts.length === 1) return { arc: 0, perp: Math.hypot(p.x - pts[0].x, p.y - pts[0].y) };

  let bestPerp = Infinity, bestArc = 0, arcSoFar = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const segLen2 = dx * dx + dy * dy;
    let t = segLen2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / segLen2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + dx * t, cy = a.y + dy * t;
    const perp = Math.hypot(p.x - cx, p.y - cy);
    const segLen = Math.sqrt(segLen2);
    if (perp < bestPerp) { bestPerp = perp; bestArc = arcSoFar + segLen * t; }
    arcSoFar += segLen;
  }
  return { arc: bestArc, perp: bestPerp };
}

/**
 * Evenly spaced points along a polyline, `step` metres apart (always
 * including both ends), each carrying its arc-length position. This is what
 * the cross-section walks to sample the structural grid into a continuous
 * trace rather than straight segments between wells.
 */
export function sampleAlongPolyline(pts: Pt[], step: number): (Pt & { arc: number })[] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return [{ x: pts[0].x, y: pts[0].y, arc: 0 }];

  const total = polylineLength(pts);
  if (total <= 0) return [{ x: pts[0].x, y: pts[0].y, arc: 0 }];

  const n = Math.max(1, Math.round(total / Math.max(step, 1e-6)));
  const out: (Pt & { arc: number })[] = [];
  let segIdx = 0, segStart = 0;
  let segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

  for (let i = 0; i <= n; i++) {
    const arc = (i / n) * total;
    while (segIdx < pts.length - 2 && arc > segStart + segLen + 1e-9) {
      segStart += segLen;
      segIdx++;
      segLen = Math.hypot(pts[segIdx + 1].x - pts[segIdx].x, pts[segIdx + 1].y - pts[segIdx].y);
    }
    const t = segLen > 0 ? (arc - segStart) / segLen : 0;
    const a = pts[segIdx], b = pts[segIdx + 1];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, arc });
  }
  return out;
}
