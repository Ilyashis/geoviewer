import type { StateCreator } from 'zustand';
import type { Marker } from '../../types';
import type { TopRow } from '../../tops/csv';
import { uid } from '../../util/id';
import { MARKER_COLORS, norm, wellIndex } from '../shared';
import type { Store } from '../types';

export interface ImportSummary {
  surfaces: number;
  picks: number;
  unmatchedWells: string[];
}

export interface MarkersSlice {
  markers: Marker[];
  selectedMarkerId: string | null;
  addMarkerAtDepth: (depth: number) => void;
  updateMarkerDepth: (markerId: string, wellId: string, depth: number) => void;
  removeMarkerDepth: (markerId: string, wellId: string) => void;
  renameMarker: (markerId: string, label: string) => void;
  removeMarker: (markerId: string) => void;
  selectMarker: (id: string | null) => void;
  importTops: (rows: TopRow[]) => ImportSummary;
}

export const createMarkersSlice: StateCreator<Store, [], [], MarkersSlice> = (set, get) => ({
  markers: [],
  selectedMarkerId: null,

  addMarkerAtDepth: (depth) =>
    set((s) => {
      const depths: Record<string, number> = {};
      for (const w of s.wells) depths[w.id] = depth;
      const marker: Marker = {
        id: `marker-${uid()}`,
        label: `Top ${s.markers.length + 1}`,
        color: MARKER_COLORS[s.markers.length % MARKER_COLORS.length],
        depths,
      };
      return { markers: [...s.markers, marker], selectedMarkerId: marker.id };
    }),

  updateMarkerDepth: (markerId, wellId, depth) =>
    set((s) => ({
      markers: s.markers.map((m) =>
        m.id === markerId ? { ...m, depths: { ...m.depths, [wellId]: depth } } : m
      ),
    })),

  removeMarkerDepth: (markerId, wellId) =>
    set((s) => ({
      markers: s.markers.map((m) => {
        if (m.id !== markerId) return m;
        const { [wellId]: _drop, ...rest } = m.depths;
        return { ...m, depths: rest };
      }),
    })),

  renameMarker: (markerId, label) =>
    set((s) => ({
      markers: s.markers.map((m) => (m.id === markerId ? { ...m, label } : m)),
    })),

  removeMarker: (markerId) =>
    set((s) => ({
      markers: s.markers.filter((m) => m.id !== markerId),
      selectedMarkerId: s.selectedMarkerId === markerId ? null : s.selectedMarkerId,
    })),

  selectMarker: (id) => set({ selectedMarkerId: id }),

  importTops: (rows) => {
    const state = get();
    const byName = wellIndex(state.wells);

    // Group picks by surface, resolving well names to ids.
    const surfaces = new Map<string, Record<string, number>>();
    const unmatched = new Set<string>();
    let picks = 0;
    for (const r of rows) {
      const wellId = byName.get(norm(r.well));
      if (!wellId) { unmatched.add(r.well); continue; }
      if (!surfaces.has(r.surface)) surfaces.set(r.surface, {});
      surfaces.get(r.surface)![wellId] = r.depth;
      picks++;
    }

    // Merge into existing markers (by label) or create new ones.
    const markers = [...state.markers];
    const byLabel = new Map(markers.map((m, i) => [norm(m.label), i]));
    for (const [surface, depths] of surfaces) {
      const existingIdx = byLabel.get(norm(surface));
      if (existingIdx != null) {
        markers[existingIdx] = { ...markers[existingIdx], depths: { ...markers[existingIdx].depths, ...depths } };
      } else {
        const marker: Marker = {
          id: `marker-${uid()}`,
          label: surface,
          color: MARKER_COLORS[markers.length % MARKER_COLORS.length],
          depths,
        };
        markers.push(marker);
        byLabel.set(norm(surface), markers.length - 1);
      }
    }

    set({ markers });
    return { surfaces: surfaces.size, picks, unmatchedWells: [...unmatched] };
  },
});
