import type { StateCreator } from 'zustand';
import type { ControlPoint } from '../../core/framework';
import type { Store } from '../types';

/**
 * Structural-framework interpretation shared across views: seismic-derived
 * horizon control points, keyed by the surface (top) label and then by which
 * seismic line contributed them — a horizon can be picked on more than one
 * line, and each line's points feed the map as a separate transect. The map
 * merges all of a label's lines with the well picks when building that surface.
 */
export interface FrameworkSlice {
  seismicHorizons: Record<string, Record<string, ControlPoint[]>>;
  setSeismicHorizon: (label: string, lineId: string, controls: ControlPoint[]) => void;
  clearSeismicHorizon: (label: string, lineId: string) => void;
}

export const createFrameworkSlice: StateCreator<Store, [], [], FrameworkSlice> = (set) => ({
  seismicHorizons: {},
  setSeismicHorizon: (label, lineId, controls) =>
    set((s) => ({
      seismicHorizons: { ...s.seismicHorizons, [label]: { ...s.seismicHorizons[label], [lineId]: controls } },
    })),
  clearSeismicHorizon: (label, lineId) =>
    set((s) => {
      const { [lineId]: _drop, ...restLines } = s.seismicHorizons[label] ?? {};
      if (Object.keys(restLines).length === 0) {
        const { [label]: _dropLabel, ...restLabels } = s.seismicHorizons;
        return { seismicHorizons: restLabels };
      }
      return { seismicHorizons: { ...s.seismicHorizons, [label]: restLines } };
    }),
});
