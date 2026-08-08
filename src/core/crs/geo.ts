/**
 * Geographic (degrees) → local metric frame.
 *
 * Maps, gridding, areas and volumes all assume metres. Coordinates that arrive
 * as longitude/latitude have to be projected before any of that means anything
 * — a field spanning 0.05° gridded as if it were metres yields an area ~10^10
 * times too small.
 *
 * A local equirectangular projection about a reference point is used: over a
 * field-sized area (tens of km) its distortion is far below the uncertainty of
 * the interpolation itself, and unlike a full UTM implementation it has no zone
 * edge cases. It is NOT a general-purpose reprojection — only a local frame in
 * which distances and areas are metric.
 */

/** Mean Earth radius (metres), WGS-84 authalic. */
export const EARTH_R = 6371008.8;

const RAD = Math.PI / 180;

export interface GeoRef { lon0: number; lat0: number }

/**
 * Project one lon/lat (degrees) into metres relative to `ref`. The reference
 * only sets the origin — any point near the data works, provided every point in
 * a set uses the SAME one, or relative geometry breaks.
 */
export function projectLocal(lon: number, lat: number, ref: GeoRef): { x: number; y: number } {
  return {
    x: EARTH_R * (lon - ref.lon0) * RAD * Math.cos(ref.lat0 * RAD),
    y: EARTH_R * (lat - ref.lat0) * RAD,
  };
}

/** Mean of the given lon/lat pairs — a sensible shared origin for a field. */
export function geoRefOf(points: { lon: number; lat: number }[]): GeoRef | null {
  if (points.length === 0) return null;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.lon; sy += p.lat; }
  return { lon0: sx / points.length, lat0: sy / points.length };
}
