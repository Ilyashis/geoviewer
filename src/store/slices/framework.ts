import type { StateCreator } from 'zustand';
import type { ControlPoint } from '../../core/framework';
import type { Store } from '../types';

/**
 * Structural-framework interpretation shared across views: seismic-derived
 * horizon control points, keyed by the surface (top) label. The map merges them
 * with the well picks when building that surface — the integration point where
 * wells and seismic meet.
 */
export interface FrameworkSlice {
  seismicHorizons: Record<string, ControlPoint[]>;
  setSeismicHorizon: (label: string, controls: ControlPoint[]) => void;
  clearSeismicHorizon: (label: string) => void;
}

export const createFrameworkSlice: StateCreator<Store, [], [], FrameworkSlice> = (set) => ({
  seismicHorizons: {},
  setSeismicHorizon: (label, controls) =>
    set((s) => ({ seismicHorizons: { ...s.seismicHorizons, [label]: controls } })),
  clearSeismicHorizon: (label) =>
    set((s) => {
      const { [label]: _drop, ...rest } = s.seismicHorizons;
      return { seismicHorizons: rest };
    }),
});
