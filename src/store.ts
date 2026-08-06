import { create } from 'zustand';
import type { LithoInterval, Marker, Well } from './types';
import { parseLasToWell } from './las/parser';
import { generateDemoLithology } from './plate/demoLithology';
import { uid } from './util/id';
import type { TopRow } from './tops/csv';
import type { LithoRow } from './lithology/csv';
import { mapLithology, mapSaturation } from './lithology/map';
import type { ProjectMeta } from './persistence';

export interface ImportSummary {
  surfaces: number;
  picks: number;
  unmatchedWells: string[];
}

export interface LithoImportSummary {
  wells: number;
  intervals: number;
  unmatchedWells: string[];
}

const MARKER_COLORS = ['#AF52DE', '#FF9500', '#B6C2CE', '#10a1ff', '#00c7be', '#09b37b', '#eb5757'];

/** Demo tops: base depth in the first well + a per-well step, for a realistic look. */
const DEMO_TOPS: { label: string; color: string; base: number; step: number }[] = [
  { label: 'Top A', color: '#AF52DE', base: 2048, step: 7 },
  { label: 'KP S8', color: '#FF9500', base: 2096, step: 5 },
  { label: 'Top B', color: '#B6C2CE', base: 2132, step: 9 },
];

interface AppState {
  wells: Well[];
  markers: Marker[];
  activeWellId: string | null;
  selectedMarkerId: string | null;
  error: string | null;
  projectId: string | null;
  projectName: string;
  projects: ProjectMeta[];
  /** Per-well hidden track titles / LITHO_KEY (view setting). */
  hiddenTracks: Record<string, string[]>;
  addLasFiles: (files: FileList | File[]) => Promise<void>;
  loadLasText: (text: string, fileName?: string) => void;
  setActiveWell: (id: string) => void;
  removeWell: (id: string) => void;
  addMarkerAtDepth: (depth: number) => void;
  updateMarkerDepth: (markerId: string, wellId: string, depth: number) => void;
  removeMarkerDepth: (markerId: string, wellId: string) => void;
  renameMarker: (markerId: string, label: string) => void;
  removeMarker: (markerId: string) => void;
  selectMarker: (id: string | null) => void;
  toggleTrack: (wellId: string, key: string) => void;
  replaceProject: (p: { wells: Well[]; markers: Marker[]; activeWellId: string | null; hiddenTracks?: Record<string, string[]> }) => void;
  clearAll: () => void;
  importTops: (rows: TopRow[]) => ImportSummary;
  importLithology: (rows: LithoRow[]) => LithoImportSummary;
  setProjects: (list: ProjectMeta[]) => void;
  setCurrentProject: (id: string, name: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  wells: [],
  markers: [],
  activeWellId: null,
  selectedMarkerId: null,
  error: null,
  hiddenTracks: {},
  projectId: null,
  projectName: 'Корреляция',
  projects: [],

  addLasFiles: async (files) => {
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        get().loadLasText(text, file.name);
      } catch (e) {
        set({ error: `Не удалось прочитать ${file.name}: ${(e as Error).message}` });
      }
    }
  },

  loadLasText: (text, fileName) => {
    try {
      const well = parseLasToWell(text, fileName);
      const isDemo = /demo/i.test(fileName ?? '');
      if (isDemo) {
        // Distinct, concept-style names so wells are addressable (e.g. by tops import).
        const i = get().wells.length;
        well.name = `UT-${1058 + i}`;
        well.lithology = generateDemoLithology(well, i + 1);
        // Scatter demo wells over a plausible field so the map has real coordinates.
        well.x = 12000 + (i % 3) * 850 + ((i * 137) % 300);
        well.y = 48000 + Math.floor(i / 3) * 700 + ((i * 91) % 260);
      }

      set((s) => {
        const wells = [...s.wells, well];
        let markers = s.markers;

        if (isDemo && s.markers.length === 0) {
          // Seed demo tops for the first demo well.
          markers = DEMO_TOPS.map((t) => ({
            id: `marker-${uid()}`,
            label: t.label,
            color: t.color,
            depths: { [well.id]: t.base },
          }));
        } else if (markers.length) {
          // Extend existing markers to the newly added well (stepped depth).
          markers = markers.map((m, i) => {
            const existing = Object.values(m.depths);
            const base = existing.length ? Math.max(...existing) : 2050;
            const step = isDemo ? (DEMO_TOPS[i]?.step ?? 6) : 6;
            return { ...m, depths: { ...m.depths, [well.id]: base + step } };
          });
        }

        return {
          wells,
          activeWellId: s.activeWellId ?? well.id,
          markers,
          error: null,
        };
      });
    } catch (e) {
      set({ error: `Ошибка разбора LAS: ${(e as Error).message}` });
    }
  },

  setActiveWell: (id) => set({ activeWellId: id }),

  removeWell: (id) =>
    set((s) => {
      const wells = s.wells.filter((w) => w.id !== id);
      const markers = wells.length === 0
        ? []
        : s.markers.map((m) => {
            const { [id]: _removed, ...rest } = m.depths;
            return { ...m, depths: rest };
          });
      return {
        wells,
        markers,
        activeWellId: s.activeWellId === id ? (wells[0]?.id ?? null) : s.activeWellId,
      };
    }),

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

  toggleTrack: (wellId, key) =>
    set((s) => {
      const cur = s.hiddenTracks[wellId] ?? [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { hiddenTracks: { ...s.hiddenTracks, [wellId]: next } };
    }),

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

  importTops: (rows) => {
    const state = get();
    const norm = (s: string) => s.trim().toLowerCase();
    const byName = new Map<string, string>(); // normalized well name/uwi -> wellId
    for (const w of state.wells) {
      byName.set(norm(w.name), w.id);
      if (w.uwi) byName.set(norm(w.uwi), w.id);
    }

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

  importLithology: (rows) => {
    const state = get();
    const norm = (s: string) => s.trim().toLowerCase();
    const byName = new Map<string, string>();
    for (const w of state.wells) {
      byName.set(norm(w.name), w.id);
      if (w.uwi) byName.set(norm(w.uwi), w.id);
    }

    // Group intervals per matched well.
    const perWell = new Map<string, LithoInterval[]>();
    const unmatched = new Set<string>();
    let intervals = 0;
    for (const r of rows) {
      const wellId = byName.get(norm(r.well));
      if (!wellId) { unmatched.add(r.well); continue; }
      const { color, pattern } = mapLithology(r.litho);
      const iv: LithoInterval = {
        top: r.top, base: r.base, color, pattern,
        sat: mapSaturation(r.sat), litho: r.litho, satName: r.sat,
      };
      if (!perWell.has(wellId)) perWell.set(wellId, []);
      perWell.get(wellId)!.push(iv);
      intervals++;
    }

    // Replace lithology for wells present in the import (sorted by depth).
    const wells = state.wells.map((w) => {
      const ivs = perWell.get(w.id);
      if (!ivs) return w;
      return { ...w, lithology: [...ivs].sort((a, b) => a.top - b.top) };
    });

    set({ wells });
    return { wells: perWell.size, intervals, unmatchedWells: [...unmatched] };
  },

  setProjects: (list) => set({ projects: list }),
  setCurrentProject: (id, name) => set({ projectId: id, projectName: name }),
}));
