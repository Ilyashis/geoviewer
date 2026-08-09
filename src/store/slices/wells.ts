import type { StateCreator } from 'zustand';
import type { LithoInterval, Well } from '../../types';
import type { LithoRow } from '../../lithology/csv';
import type { SurveyRow } from '../../survey/csv';
import type { WellHeadRow } from '../../wells/heads';
import { parseDev, type ParsedDev } from '../../wells/dev';
import { parseCheckshots } from '../../wells/checkshot';
import { segyToLine } from '../../seismic/segy';
import { readTextFile } from '../../util/encoding';
import type { SurveyStation } from '../../wells/deviation';
import { parseLasToWell } from '../../las/parser';
import { generateDemoLithology } from '../../plate/demoLithology';
import { mapLithology, mapSaturation } from '../../lithology/map';
import { buildDemoLas } from '../../sampleData';
import { uid } from '../../util/id';
import { DEMO_TOPS, demoSurvey, norm, wellIndex } from '../shared';
import type { Store } from '../types';

export interface LithoImportSummary {
  wells: number;
  intervals: number;
  unmatchedWells: string[];
}

export interface SurveyImportSummary {
  wells: number;
  stations: number;
  unmatchedWells: string[];
}

export interface HeadsImportSummary {
  wells: number;
  withKb: number;
  unmatchedWells: string[];
}

export interface DevImportSummary {
  wells: number;
  withKb: number;
  deviated: number;
  unmatchedWells: string[];
}

export interface KbImportSummary {
  wells: number;
  /** Wells that already carried a different elevation, now overwritten. */
  replaced: { well: string; was: number }[];
  unmatchedWells: string[];
}

export interface WellsSlice {
  wells: Well[];
  activeWellId: string | null;
  error: string | null;
  /** Per-well hidden track titles / LITHO_KEY (view setting). */
  hiddenTracks: Record<string, string[]>;
  addLasFiles: (files: FileList | File[]) => Promise<void>;
  loadLasText: (text: string, fileName?: string) => void;
  /** Replace the project with a ready demo field: several varied, partly-deviated wells + tops. */
  loadDemoField: (count?: number) => void;
  setActiveWell: (id: string) => void;
  removeWell: (id: string) => void;
  toggleTrack: (wellId: string, key: string) => void;
  importLithology: (rows: LithoRow[]) => LithoImportSummary;
  importSurveys: (rows: SurveyRow[]) => SurveyImportSummary;
  importWellHeads: (rows: WellHeadRow[]) => HeadsImportSummary;
  importDevTraces: (traces: ParsedDev[]) => DevImportSummary;
  importWellKb: (rows: { well: string; kb: number }[]) => KbImportSummary;
}

export const createWellsSlice: StateCreator<Store, [], [], WellsSlice> = (set, get) => ({
  wells: [],
  activeWellId: null,
  error: null,
  hiddenTracks: {},

  /**
   * Accepts a mixed drop of well files. `.dev` (Petrel well trace) is applied
   * after the LAS files regardless of drop order — it patches existing wells
   * with their head coordinates, so the wells have to exist first.
   */
  addLasFiles: async (files) => {
    const all = Array.from(files);
    const isDev = (f: File) => /\.dev$/i.test(f.name);
    const isSegy = (f: File) => /\.se?g?y$/i.test(f.name);

    for (const file of all.filter((f) => !isDev(f) && !/\.asc$/i.test(f.name) && !isSegy(f))) {
      try {
        get().loadLasText(await readTextFile(file), file.name);
      } catch (e) {
        set({ error: `Не удалось прочитать ${file.name}: ${(e as Error).message}` });
      }
    }

    // Checkshots (.asc) — the measured time–depth relation.
    const asc = all.filter((f) => /\.asc$/i.test(f.name));
    if (asc.length) {
      const parsed = [];
      for (const file of asc) {
        try { parsed.push(...parseCheckshots(await readTextFile(file))); }
        catch (e) { set({ error: `Не удалось прочитать ${file.name}: ${(e as Error).message}` }); }
      }
      if (parsed.length) get().setCheckshots(parsed);
    }

    // SEG-Y lines — read as binary, shown as their own sections.
    for (const file of all.filter(isSegy)) {
      try {
        get().addSegyLine(segyToLine(await file.arrayBuffer(), file.name));
      } catch (e) {
        set({ error: `Не удалось прочитать ${file.name}: ${(e as Error).message}` });
      }
    }

    const devs = all.filter(isDev);
    if (devs.length === 0) return;
    const parsed: ParsedDev[] = [];
    for (const file of devs) {
      try {
        parsed.push(parseDev(await readTextFile(file), file.name));
      } catch (e) {
        set({ error: `Не удалось прочитать ${file.name}: ${(e as Error).message}` });
      }
    }
    get().importDevTraces(parsed);
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
        // Make every other demo well deviated, so TVD/offset is exercised.
        if (i % 2 === 1) well.survey = demoSurvey(i);
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

  loadDemoField: (count = 6) => {
    get().clearAll();
    for (let i = 0; i < count; i++) get().loadLasText(buildDemoLas(i), `andromeda-demo-${i}.las`);
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

  toggleTrack: (wellId, key) =>
    set((s) => {
      const cur = s.hiddenTracks[wellId] ?? [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { hiddenTracks: { ...s.hiddenTracks, [wellId]: next } };
    }),

  importLithology: (rows) => {
    const state = get();
    const byName = wellIndex(state.wells);

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

  importSurveys: (rows) => {
    const state = get();
    const byName = wellIndex(state.wells);

    const perWell = new Map<string, SurveyStation[]>();
    const unmatched = new Set<string>();
    let stations = 0;
    for (const r of rows) {
      const wellId = byName.get(norm(r.well));
      if (!wellId) { unmatched.add(r.well); continue; }
      if (!perWell.has(wellId)) perWell.set(wellId, []);
      perWell.get(wellId)!.push({ md: r.md, inc: r.inc, azi: r.azi });
      stations++;
    }

    // Replace the survey for wells present in the import (sorted by MD).
    const wells = state.wells.map((w) => {
      const s = perWell.get(w.id);
      return s ? { ...w, survey: [...s].sort((a, b) => a.md - b.md) } : w;
    });

    set({ wells });
    return { wells: perWell.size, stations, unmatchedWells: [...unmatched] };
  },

  /**
   * Attach surface coordinates and KB from a well-heads table. Kept separate
   * from the LAS import because real exporters (Petrel among them) leave X/Y/KB
   * out of the LAS entirely — without this the whole field has no position and
   * nothing spatial works.
   */
  importWellHeads: (rows) => {
    const state = get();
    const byName = wellIndex(state.wells);
    const patch = new Map<string, WellHeadRow>();
    const unmatched = new Set<string>();
    for (const r of rows) {
      const wellId = byName.get(norm(r.well));
      if (!wellId) { unmatched.add(r.well); continue; }
      patch.set(wellId, r);
    }

    let withKb = 0;
    const wells = state.wells.map((w) => {
      const r = patch.get(w.id);
      if (!r) return w;
      if (r.kb !== undefined) withKb++;
      // Coordinates from a table are projected metres, never lon/lat degrees.
      return { ...w, x: r.x, y: r.y, geodetic: false, kb: r.kb ?? w.kb };
    });

    set({ wells });
    return { wells: patch.size, withKb, unmatchedWells: [...unmatched] };
  },

  /**
   * Apply Petrel well traces: head coordinates + KB from the comment header,
   * and the trajectory when the trace actually leaves vertical. A vertical stub
   * carries no trajectory information, so it must not overwrite a real survey
   * that was imported from elsewhere.
   */
  importDevTraces: (traces) => {
    const state = get();
    const byName = wellIndex(state.wells);
    const patch = new Map<string, ParsedDev>();
    const unmatched = new Set<string>();
    for (const d of traces) {
      const wellId = byName.get(norm(d.well));
      if (!wellId) { unmatched.add(d.well); continue; }
      patch.set(wellId, d);
    }

    let withKb = 0, deviated = 0;
    const wells = state.wells.map((w) => {
      const d = patch.get(w.id);
      if (!d) return w;
      if (d.kb !== undefined) withKb++;
      if (d.deviated) deviated++;
      return {
        ...w,
        x: d.x ?? w.x,
        y: d.y ?? w.y,
        geodetic: d.x !== undefined ? false : w.geodetic,
        kb: d.kb ?? w.kb,
        survey: d.survey.length ? d.survey : w.survey,
      };
    });

    set({ wells });
    return { wells: patch.size, withKb, deviated, unmatchedWells: [...unmatched] };
  },

  /**
   * Apply a depth-reference elevation on its own, from a file that carries no
   * coordinates — an inclinometry report names its datum in the preamble and is
   * often the only place it appears. Kept separate from `importWellHeads`,
   * which would blank X/Y it has nothing to say about.
   *
   * An elevation that was already known is replaced rather than kept, because
   * the caller asked for this file to be applied — but the previous value is
   * reported back so the change is never silent.
   */
  importWellKb: (rows) => {
    const state = get();
    const byName = wellIndex(state.wells);
    const patch = new Map<string, number>();
    const unmatched = new Set<string>();
    for (const r of rows) {
      const wellId = byName.get(norm(r.well));
      if (!wellId) { unmatched.add(r.well); continue; }
      if (Number.isFinite(r.kb)) patch.set(wellId, r.kb);
    }

    const replaced: { well: string; was: number }[] = [];
    const wells = state.wells.map((w) => {
      const kb = patch.get(w.id);
      if (kb === undefined) return w;
      if (w.kb !== undefined && Math.abs(w.kb - kb) > 0.01) replaced.push({ well: w.name, was: w.kb });
      return { ...w, kb };
    });

    set({ wells });
    return { wells: patch.size, replaced, unmatchedWells: [...unmatched] };
  },
});
