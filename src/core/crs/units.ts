/**
 * Length units and normalisation.
 *
 * The project works internally in metres. Import adapters (LAS, seismic, CSV)
 * detect the source unit and normalise through here, so unit handling lives in
 * one place instead of being scattered as ad-hoc feet→metre factors.
 */

export type LengthUnit = 'm' | 'ft';

export const M_PER_FT = 0.3048;

const FT_RE = /^(ft|feet|f|')$/i;

/** Classify a raw unit string (e.g. from a LAS ~Curve line). Unknown ⇒ metres. */
export function lengthUnitOf(raw: string | undefined): LengthUnit {
  return FT_RE.test((raw ?? '').trim()) ? 'ft' : 'm';
}

/** Convert a value to metres given its unit. */
export function toMetres(value: number, unit: LengthUnit): number {
  return unit === 'ft' ? value * M_PER_FT : value;
}
