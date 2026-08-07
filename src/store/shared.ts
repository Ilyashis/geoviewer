import type { Well } from '../types';
import type { SurveyStation } from '../wells/deviation';

export const MARKER_COLORS = ['#AF52DE', '#FF9500', '#B6C2CE', '#10a1ff', '#00c7be', '#09b37b', '#eb5757'];

/** Demo tops: base depth in the first well + a per-well step, for a realistic look. */
export const DEMO_TOPS: { label: string; color: string; base: number; step: number }[] = [
  { label: 'Top A', color: '#AF52DE', base: 2048, step: 7 },
  { label: 'KP S8', color: '#FF9500', base: 2096, step: 5 },
  { label: 'Top B', color: '#B6C2CE', base: 2132, step: 9 },
];

/** A deviated demo trajectory: vertical to a kickoff, build angle, then hold. */
export function demoSurvey(i: number): SurveyStation[] {
  const azi = (i * 97) % 360;
  const maxInc = 22 + (i % 3) * 12; // 22° / 34° / 46°
  return [
    { md: 0, inc: 0, azi },
    { md: 1600, inc: 0, azi },
    { md: 2200, inc: maxInc, azi },
    { md: 3200, inc: maxInc, azi },
  ];
}

export const norm = (s: string) => s.trim().toLowerCase();

/** Map of normalised well name/UWI → well id, for resolving import rows to wells. */
export function wellIndex(wells: Well[]): Map<string, string> {
  const byName = new Map<string, string>();
  for (const w of wells) {
    byName.set(norm(w.name), w.id);
    if (w.uwi) byName.set(norm(w.uwi), w.id);
  }
  return byName;
}
