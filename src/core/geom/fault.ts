import type { Pt } from './polygon';
import type { ControlPoint } from './grid';

/**
 * Signed side of a point relative to the NEAREST segment of a (possibly
 * multi-segment) trace: positive on one side, negative on the other, ~0 on the
 * line itself. Only the sign is meaningful — magnitude isn't a calibrated
 * distance. Used to split control points into fault blocks.
 */
export function sideOfPolyline(pt: Pt, trace: Pt[]): number {
  if (trace.length < 2) return 0;
  let bestD2 = Infinity, bestSide = 0;
  for (let i = 0; i < trace.length - 1; i++) {
    const a = trace[i], b = trace[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2)) : 0;
    const cx = a.x + t * dx, cy = a.y + t * dy;
    const d2 = (pt.x - cx) ** 2 + (pt.y - cy) ** 2;
    if (d2 < bestD2) { bestD2 = d2; bestSide = dx * (pt.y - a.y) - dy * (pt.x - a.x); }
  }
  return bestSide;
}

/**
 * Whether two points are on the same side of every given fault trace — a point
 * exactly on a trace (sign 0) never excludes a pairing, so gridding near the
 * trace degrades gracefully instead of leaving cells starved of points.
 */
export function sameFaultBlock(a: Pt, b: Pt, traces: Pt[][]): boolean {
  for (const trace of traces) {
    const sa = Math.sign(sideOfPolyline(a, trace));
    const sb = Math.sign(sideOfPolyline(b, trace));
    if (sa !== 0 && sb !== 0 && sa !== sb) return false;
  }
  return true;
}

function idwAt(pt: Pt, points: ControlPoint[], power = 2): number | null {
  let num = 0, den = 0;
  for (const p of points) {
    const d2 = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
    if (d2 < 1e-9) return p.z;
    const w = 1 / Math.pow(d2, power / 2);
    num += w * p.z; den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * Unit vector toward the downthrown side of a fault, given the local trace
 * tangent and the sign of a throw measurement (`estimateThrow`'s convention:
 * positive means the side with `sideOfPolyline < 0` sits deeper). Always
 * perpendicular to the trace — a fault dips across itself, never along its
 * own strike.
 */
export function dipDirection(tangent: Pt, throwSign: number): Pt {
  const len = Math.hypot(tangent.x, tangent.y);
  if (len < 1e-9) return { x: 0, y: 0 };
  const ux = tangent.x / len, uy = tangent.y / len;
  const left = { x: -uy, y: ux }; // rotate +90°, matches sideOfPolyline's side > 0
  return throwSign >= 0 ? { x: -left.x, y: -left.y } : left;
}

/**
 * Apparent dip on a vertical section: a plane with true dip `trueDipDeg`
 * (degrees from horizontal) dipping toward `dipDirVec`, cut by a section
 * running along `sectionDirVec`, appears to dip at this angle instead —
 * standard relation tan(apparent) = tan(true) × cos(angle between the
 * section and the dip direction). Signed: positive means the plane gets
 * deeper as the section runs forward along `sectionDirVec`. A section
 * running along strike (perpendicular to the dip direction) sees the plane
 * as flat (0°), same as looking down a structure contour. Null when either
 * direction is degenerate (zero-length) — nothing to project onto.
 */
export function apparentDipDeg(trueDipDeg: number, dipDirVec: Pt, sectionDirVec: Pt): number | null {
  const dLen = Math.hypot(dipDirVec.x, dipDirVec.y), sLen = Math.hypot(sectionDirVec.x, sectionDirVec.y);
  if (dLen < 1e-9 || sLen < 1e-9) return null;
  const cosA = (dipDirVec.x * sectionDirVec.x + dipDirVec.y * sectionDirVec.y) / (dLen * sLen);
  const trueDipRad = (trueDipDeg * Math.PI) / 180;
  return (Math.atan(Math.tan(trueDipRad) * cosA) * 180) / Math.PI;
}

/**
 * The apparent throw at a fault: each side's own control points are gridded
 * (independently) to a value at the trace's midpoint, and the two are
 * subtracted. This is DERIVED from whatever picks exist on each side rather
 * than a typed-in guess — null when either side has no points to interpolate
 * from. Positive means the second-side sign (sideOfPolyline < 0) sits deeper.
 */
export function estimateThrow(trace: Pt[], points: ControlPoint[]): number | null {
  if (trace.length < 2 || points.length === 0) return null;
  const mid = {
    x: trace.reduce((s, p) => s + p.x, 0) / trace.length,
    y: trace.reduce((s, p) => s + p.y, 0) / trace.length,
  };
  const sides = points.map((p) => Math.sign(sideOfPolyline(p, trace)));
  const a = points.filter((_, i) => sides[i] > 0);
  const b = points.filter((_, i) => sides[i] < 0);
  if (a.length === 0 || b.length === 0) return null;
  const za = idwAt(mid, a), zb = idwAt(mid, b);
  return za == null || zb == null ? null : zb - za;
}
