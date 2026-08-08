import { create } from 'zustand';
import { createWellsSlice } from './slices/wells';
import { createMarkersSlice } from './slices/markers';
import { createProjectSlice } from './slices/project';
import { createFrameworkSlice } from './slices/framework';
import type { Store } from './types';

export type { Store } from './types';
export type { ImportSummary } from './slices/markers';
export type { LithoImportSummary, SurveyImportSummary, HeadsImportSummary, DevImportSummary } from './slices/wells';

/** God-store split into domain slices (wells · markers · project). Slices share
 *  one set/get, so cross-slice calls (loadDemoField → clearAll) still work. */
export const useStore = create<Store>()((...a) => ({
  ...createWellsSlice(...a),
  ...createMarkersSlice(...a),
  ...createProjectSlice(...a),
  ...createFrameworkSlice(...a),
}));
