import type { StateCreator } from 'zustand';
import type { Marker, Well } from '../../types';
import type { ProjectMeta } from '../../persistence';
import type { ControlPoint } from '../../core/framework';
import type { WellCheckshot } from '../../wells/checkshot';
import type { SegyLine } from '../../seismic/segy';
import type { Store } from '../types';
import type { FaultDef, SectionLine } from './framework';

export interface ProjectSlice {
  projectId: string | null;
  projectName: string;
  projects: ProjectMeta[];
  replaceProject: (p: {
    wells: Well[];
    markers: Marker[];
    activeWellId: string | null;
    hiddenTracks?: Record<string, string[]>;
    faults?: FaultDef[];
    sections?: SectionLine[];
    checkshots?: WellCheckshot[];
    segyLines?: SegyLine[];
    seismicHorizons?: Record<string, Record<string, ControlPoint[]>>;
  }) => void;
  clearAll: () => void;
  setProjects: (list: ProjectMeta[]) => void;
  setCurrentProject: (id: string, name: string) => void;
}

/** Project lifecycle & metadata. clearAll / replaceProject reset fields owned by
 *  the wells, markers and framework slices — Zustand's set writes across the
 *  whole store. */
export const createProjectSlice: StateCreator<Store, [], [], ProjectSlice> = (set) => ({
  projectId: null,
  projectName: 'Корреляция',
  projects: [],

  replaceProject: (p) =>
    set({
      wells: p.wells,
      markers: p.markers,
      activeWellId: p.activeWellId ?? p.wells[0]?.id ?? null,
      hiddenTracks: p.hiddenTracks ?? {},
      faults: p.faults ?? [],
      sections: p.sections ?? [],
      checkshots: p.checkshots ?? [],
      segyLines: p.segyLines ?? [],
      seismicHorizons: p.seismicHorizons ?? {},
      selectedMarkerId: null,
      error: null,
    }),

  clearAll: () =>
    set({
      wells: [],
      markers: [],
      activeWellId: null,
      hiddenTracks: {},
      faults: [],
      sections: [],
      checkshots: [],
      segyLines: [],
      seismicHorizons: {},
      selectedMarkerId: null,
      error: null,
    }),

  setProjects: (list) => set({ projects: list }),
  setCurrentProject: (id, name) => set({ projectId: id, projectName: name }),
});
