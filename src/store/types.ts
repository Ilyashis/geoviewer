import type { WellsSlice } from './slices/wells';
import type { MarkersSlice } from './slices/markers';
import type { ProjectSlice } from './slices/project';

/** The full store — composed of the domain slices; each slice's set/get sees this. */
export type Store = WellsSlice & MarkersSlice & ProjectSlice;
