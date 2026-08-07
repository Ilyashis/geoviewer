import type { StateCreator } from 'zustand';
import type { Marker, Well } from '../../types';
import type { ProjectMeta } from '../../persistence';
import type { Store } from '../types';

export interface ProjectSlice {
  projectId: string | null;
  projectName: string;
  projects: ProjectMeta[];
  replaceProject: (p: { wells: Well[]; markers: Marker[]; activeWellId: string | null; hiddenTracks?: Record<string, string[]> }) => void;
  clearAll: () => void;
  setProjects: (list: ProjectMeta[]) => void;
  setCurrentProject: (id: string, name: string) => void;
}

/** Project lifecycle & metadata. clearAll / replaceProject reset fields owned by
 *  the wells and markers slices — Zustand's set writes across the whole store. */
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
      selectedMarkerId: null,
      error: null,
    }),

  clearAll: () => set({ wells: [], markers: [], activeWellId: null, hiddenTracks: {}, selectedMarkerId: null, error: null }),

  setProjects: (list) => set({ projects: list }),
  setCurrentProject: (id, name) => set({ projectId: id, projectName: name }),
});
