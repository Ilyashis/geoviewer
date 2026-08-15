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

function segmentIntersectionT(p1: Pt, p2: Pt, p3: Pt, p4: Pt): number | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null; // parallel (or collinear) — no single crossing point
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

function unit(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy);
  return len > 1e-9 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
}

export interface Crossing {
  /** Arc-length position along `line` where the crossing occurs. */
  arc: number;
  /** Unit tangent of `line`'s own segment at the crossing. */
  lineDir: Pt;
  /** Unit tangent of `other`'s segment at the crossing. */
  otherDir: Pt;
}

/**
 * Where the polyline `other` crosses `line` — used to mark a fault trace on
 * a cross-section. Carries both segments' local tangents (not just the arc
 * position) so a caller with a known dip can work out the *apparent* dip
 * for this particular crossing (`core/geom/fault.ts`'s `apparentDipDeg`) —
 * a fault's true dip looks different depending on which way the section
 * happens to cut across it.
 */
export function polylineCrossings(line: Pt[], other: Pt[]): Crossing[] {
  if (line.length < 2 || other.length < 2) return [];
  const out: Crossing[] = [];
  let cum = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    for (let j = 1; j < other.length; j++) {
      const c = other[j - 1], d = other[j];
      const t = segmentIntersectionT(a, b, c, d);
      if (t != null) {
        out.push({ arc: cum + t * segLen, lineDir: unit(b.x - a.x, b.y - a.y), otherDir: unit(d.x - c.x, d.y - c.y) });
      }
    }
    cum += segLen;
  }
  return out.sort((x, y) => x.arc - y.arc);
}
