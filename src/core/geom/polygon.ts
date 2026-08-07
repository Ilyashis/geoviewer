export interface Pt { x: number; y: number }

/**
 * Even-odd point-in-polygon test (ray casting). The polygon is treated as
 * implicitly closed (last point connects back to the first) regardless of
 * whether the caller repeated the first point at the end.
 */
export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const crosses = yi > pt.y !== yj > pt.y;
    if (crosses && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
