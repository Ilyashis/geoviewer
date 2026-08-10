import type { StateCreator } from 'zustand';
import type { Marker } from '../../types';
import type { TopRow } from '../../tops/csv';
import { uid } from '../../util/id';
import { seedMarkerDepths } from '../../wells/seed';
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
  /**
   * `wellId` is the well the pick actually happened on — the one depth in
   * this call that is a real observation. Every other well is seeded from its
   * nearest already-picked neighbour (see `wells/seed`) rather than copied
   * flat, so a brand-new marker doesn't start as a perfectly horizontal line
   * cutting through wells with different KBs and trajectories.
   */
  addMarkerAtDepth: (wellId: string, depth: number) => void;
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

  addMarkerAtDepth: (wellId, depth) =>
    set((s) => {
      const seeded = seedMarkerDepths(s.wells, { [wellId]: depth });
      const depths: Record<string, number> = {};
      const seededIds: string[] = [];
      for (const [id, outcome] of Object.entries(seeded)) {
        depths[id] = outcome.depth;
        if (id !== wellId) seededIds.push(id); // everyone but the real pick is a guess
      }
      const marker: Marker = {
        id: `marker-${uid()}`,
        label: `Top ${s.markers.length + 1}`,
        color: MARKER_COLORS[s.markers.length % MARKER_COLORS.length],
        depths,
        seeded: seededIds,
      };
      return { markers: [...s.markers, marker], selectedMarkerId: marker.id };
    }),

  updateMarkerDepth: (markerId, wellId, depth) =>
    set((s) => ({
      markers: s.markers.map((m) => {
        if (m.id !== markerId) return m;
        // A hand edit — drag or typed — is the geologist looking at this well
        // and deciding on a depth. Whatever the previous value was, it's no
        // longer a guess, even if the number happens to land unchanged.
        const seeded = m.seeded?.filter((id) => id !== wellId);
        return { ...m, depths: { ...m.depths, [wellId]: depth }, seeded };
      }),
    })),

  removeMarkerDepth: (markerId, wellId) =>
    set((s) => ({
      markers: s.markers.map((m) => {
        if (m.id !== markerId) return m;
        const { [wellId]: _drop, ...rest } = m.depths;
        return { ...m, depths: rest, seeded: m.seeded?.filter((id) => id !== wellId) };
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
        const prev = markers[existingIdx];
        // A pick from an imported file is a real, external observation — it
        // overrides whatever guess (if any) sat there before.
        const seeded = prev.seeded?.filter((id) => !(id in depths));
        markers[existingIdx] = { ...prev, depths: { ...prev.depths, ...depths }, seeded };
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
