import type { LengthUnit } from './units';

/**
 * Coordinate reference for the project — the shared spatial frame that wells and
 * (later) seismic both attach to. Kept deliberately small: today every project is
 * "local metres, KB datum", but having the concept in the core means a seismic
 * volume and a well set reference ONE frame instead of guessing per-dataset.
 */

/** Vertical reference for depths. */
export type VerticalDatum = 'KB' | 'MSL' | 'GL'; // kelly bushing · mean sea level · ground level

export interface ProjectCrs {
  /** Human label, e.g. "Локальная (метры)" or "UTM 40N / м". */
  name: string;
  /** Canonical horizontal & depth unit — data is normalised to this on import. */
  lengthUnit: LengthUnit;
  /** Vertical datum for depths. */
  verticalDatum: VerticalDatum;
}

/** Default frame: local projected metres, depths referenced to KB. */
export const DEFAULT_CRS: ProjectCrs = { name: 'Локальная (метры)', lengthUnit: 'm', verticalDatum: 'KB' };

/**
 * Subsea true vertical depth: TVD measured down from the reference (KB), shifted
 * by the KB elevation above sea level. `kb` absent ⇒ TVDSS = TVD.
 */
export function tvdss(tvd: number, kb: number | undefined = 0): number {
  return tvd - (kb ?? 0);
}
