/**
 * Core data model for GeoViewer.
 *
 * Kept deliberately small for the LAS MVP, but structured so it can grow toward
 * a full geoscience project (trajectories/TVD, seismic, grids) without a rewrite.
 */

/** A single logged curve (channel) within a well. */
export interface Curve {
  /** Mnemonic, e.g. "GR", "RHOB", "NPHI". */
  mnemonic: string;
  /** Unit string as declared in the LAS ~Curve section, e.g. "GAPI". */
  unit: string;
  /** Optional human description from the LAS file. */
  description: string;
  /**
   * Values aligned index-for-index with the well's depth array.
   * LAS NULL values are converted to `null` (never NaN) so consumers can
   * distinguish "no data" from a real 0.
   */
  values: (number | null)[];
}

/** Fill pattern for a lithology block (mirrors the domain texture set). */
export type LithoPattern = 'solid' | 'diag' | 'brick' | 'dots' | 'dash';

/** A lithology/saturation interval drawn as a stacked block on the plate. */
export interface LithoInterval {
  top: number;
  base: number;
  /** Lithology fill colour (from correlation/texture domain tokens). */
  color: string;
  pattern: LithoPattern;
  /** Optional saturation colour drawn as a thin ribbon beside the block. */
  sat?: string;
  /** Source lithology type name, preserved for round-trip export. */
  litho?: string;
  /** Source saturation name, preserved for round-trip export. */
  satName?: string;
}

/** A well is the primary container of log data. */
export interface Well {
  id: string;
  name: string;
  /** Unique Well Identifier, if present (~Well UWI/API). */
  uwi?: string;
  /** Surface location; optional until we import headers/coordinates. */
  x?: number;
  y?: number;
  /** Measured depth samples (the index curve). All curves share this array. */
  depth: number[];
  /** Unit of the depth index, e.g. "M" or "FT". */
  depthUnit: string;
  /** Data curves keyed by mnemonic (excludes the depth index itself). */
  curves: Curve[];
  /** Lithology/saturation intervals (empty until imported or demo-seeded). */
  lithology: LithoInterval[];
  /** Raw ~Well header params, kept for display / future use. */
  header: Record<string, string>;
}

/**
 * A correlation marker (stratigraphic surface) tying wells together.
 * `depths` holds the picked measured depth per well id — the surface can sit at
 * a different depth in each well, which is what the stepped line visualises.
 */
export interface Marker {
  id: string;
  label: string;
  color: string;
  depths: Record<string, number>;
}

/** How a single curve is drawn on a track. */
export interface CurveStyle {
  mnemonic: string;
  color: string;
  /** Linear or logarithmic horizontal scale (resistivity → log). */
  scale: 'linear' | 'log';
  min?: number;
  max?: number;
}

/** A track is one vertical column on a well-log plate. */
export interface Track {
  id: string;
  title: string;
  widthPx: number;
  curves: CurveStyle[];
}

/** A reusable plate layout applied across wells. */
export interface Template {
  id: string;
  name: string;
  tracks: Track[];
}

export interface Project {
  name: string;
  wells: Well[];
}
