import type { Well } from '../types';
import { geoRefOf, projectLocal } from '../core/crs';

/**
 * Normalise a well set to a metric frame: wells whose x/y arrived as
 * longitude/latitude (`geodetic`) are projected to metres about the set's own
 * mean position; already-projected wells pass through untouched.
 *
 * Call this once at the top of anything spatial (maps, gridding, volumes,
 * seismic lines) so the rest of the code can assume metres. Because the
 * reference is derived from the wells handed in, every consumer given the same
 * well set lands in the same frame — no shared state to keep in sync. The
 * origin shifts as wells are added, but only ever re-centres the frame;
 * distances, areas and volumes between wells are unaffected.
 */
export function metricWells(wells: Well[]): Well[] {
  const geo = wells.filter((w) => w.geodetic && Number.isFinite(w.x) && Number.isFinite(w.y));
  if (geo.length === 0) return wells;

  const ref = geoRefOf(geo.map((w) => ({ lon: w.x!, lat: w.y! })));
  if (!ref) return wells;

  return wells.map((w) => {
    if (!w.geodetic || !Number.isFinite(w.x) || !Number.isFinite(w.y)) return w;
    const { x, y } = projectLocal(w.x!, w.y!, ref);
    return { ...w, x, y, geodetic: false };
  });
}
