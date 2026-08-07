export interface Pt { x: number; y: number }

/**
 * Where two line SEGMENTS (not infinite lines) cross, if at all — used to tie
 * seismic lines together at their physical crossing point. Returns the point
 * plus each segment's fractional position (0 at the first endpoint, 1 at the
 * second) so a caller can sample a value carried along either segment there.
 */
export function segmentIntersection(a0: Pt, a1: Pt, b0: Pt, b1: Pt): { x: number; y: number; fa: number; fb: number } | null {
  const dax = a1.x - a0.x, day = a1.y - a0.y;
  const dbx = b1.x - b0.x, dby = b1.y - b0.y;
  const denom = dax * dby - dbx * day;
  if (Math.abs(denom) < 1e-9) return null; // parallel or collinear

  const dx = b0.x - a0.x, dy = b0.y - a0.y;
  const fa = (dby * dx - dbx * dy) / denom;
  const fb = (day * dx - dax * dy) / denom;
  if (fa < 0 || fa > 1 || fb < 0 || fb > 1) return null; // crosses outside one of the segments

  return { x: a0.x + fa * dax, y: a0.y + fa * day, fa, fb };
}
