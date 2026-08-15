import type { StateCreator } from 'zustand';
import type { ControlPoint } from '../../core/framework';
import type { WellCheckshot } from '../../wells/checkshot';
import type { SegyLine } from '../../seismic/segy';
import type { Pt } from '../../core/geom/polygon';
import type { TiePoint } from '../../core/geom/similarity';
import type { Store } from '../types';

/**
 * Structural-framework interpretation shared across views: seismic-derived
 * horizon control points, keyed by the surface (top) label and then by which
 * seismic line contributed them — a horizon can be picked on more than one
 * line, and each line's points feed the map as a separate transect. The map
 * merges all of a label's lines with the well picks when building that surface.
 */
/**
 * A fault: its trace in plan view, and the пласты whose surfaces its plane
 * cuts (usually all of them — a fault dying out upwards cuts only some).
 */
export interface FaultDef {
  id: string;
  label: string;
  markerIds: string[];
  trace: Pt[];
  /**
   * True dip, degrees from horizontal (90 = vertical). Unlike throw, this
   * can't be derived from picks alone — a plan-view trace plus scattered
   * depths gives no separation to measure an angle from — so it's the one
   * fault property that's typed in rather than computed. Which way it dips
   * is still derived, from the sign of `estimateThrow` at the fault's cut
   * markers, not asked for separately. Absent ⇒ unknown, same as before
   * this field existed — rendered vertical, not assumed flat or steep.
   */
  dip?: number;
}

/**
 * A cross-section line: a polyline drawn on the map, walked by
 * `components/CrossSectionView` to place wells by real along-line distance
 * and to sample the structural grid into a continuous trace. Lives here, not
 * in the map view's own state, for the same reason faults do — the section
 * tab is a separate mounted component and needs the line to survive leaving
 * the map.
 */
export interface SectionLine {
  id: string;
  label: string;
  points: Pt[];
}

export interface FrameworkSlice {
  /** Measured time–depth pairs per well — the real velocity control. */
  checkshots: WellCheckshot[];
  setCheckshots: (cs: WellCheckshot[]) => void;
  /** Imported SEG-Y lines, shown as their own sections. */
  segyLines: SegyLine[];
  addSegyLine: (line: SegyLine) => void;
  removeSegyLine: (id: string) => void;
  setSegyLineTie: (id: string, tie: [TiePoint, TiePoint] | undefined) => void;
  /**
   * Faults, held here rather than inside the map view: the views are mounted
   * one at a time, so state living in the map was silently discarded the
   * moment the user looked at anything else — and the 3D scene draws the same
   * fault planes the map draws.
   */
  faults: FaultDef[];
  setFaults: (faults: FaultDef[] | ((prev: FaultDef[]) => FaultDef[])) => void;
  sections: SectionLine[];
  setSections: (sections: SectionLine[] | ((prev: SectionLine[]) => SectionLine[])) => void;
  seismicHorizons: Record<string, Record<string, ControlPoint[]>>;
  setSeismicHorizon: (label: string, lineId: string, controls: ControlPoint[]) => void;
  clearSeismicHorizon: (label: string, lineId: string) => void;
  /**
   * "Show this" from the data panel — a tab switch alone isn't enough when
   * the target lives behind that view's own local selection state (which
   * seismic line, which section line). The target view watches this, applies
   * the selection, then clears it — a one-shot signal, not a persisted one.
   */
  focusRequest: { target: 'seismicLine' | 'section'; id: string } | null;
  setFocusRequest: (f: { target: 'seismicLine' | 'section'; id: string } | null) => void;
}

export const createFrameworkSlice: StateCreator<Store, [], [], FrameworkSlice> = (set) => ({
  checkshots: [],
  // Merge by well: importing one file must not drop the wells already loaded.
  setCheckshots: (cs) =>
    set((s) => {
      const byWell = new Map(s.checkshots.map((c) => [c.well, c]));
      for (const c of cs) byWell.set(c.well, c);
      return { checkshots: [...byWell.values()] };
    }),
  segyLines: [],
  // Re-importing the same file replaces it rather than stacking duplicates.
  addSegyLine: (line) =>
    set((s) => ({ segyLines: [...s.segyLines.filter((l) => l.id !== line.id), line] })),
  removeSegyLine: (id) => set((s) => ({ segyLines: s.segyLines.filter((l) => l.id !== id) })),
  setSegyLineTie: (id, tie) =>
    set((s) => ({ segyLines: s.segyLines.map((l) => (l.id === id ? { ...l, tie } : l)) })),
  faults: [],
  setFaults: (faults) =>
    set((s) => ({ faults: typeof faults === 'function' ? faults(s.faults) : faults })),
  sections: [],
  setSections: (sections) =>
    set((s) => ({ sections: typeof sections === 'function' ? sections(s.sections) : sections })),
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
  focusRequest: null,
  setFocusRequest: (f) => set({ focusRequest: f }),
});
