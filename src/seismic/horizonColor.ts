/**
 * A well top always has a colour; a seismic pick that isn't one — an imported
 * line's numbered horizon ("1", "2"…) or a cube's «Горизонт N» — doesn't,
 * since nothing carries colour into the saved ControlPoint[]. Fall back to a
 * small fixed palette, picked deterministically from the label so the same
 * horizon keeps the same colour across renders, reloads and views (the
 * seismic line, the cube and the map must all agree on it).
 */
export const FALLBACK_HORIZON_COLORS = ['#10a1ff', '#FF9500', '#09b37b', '#AF52DE', '#eb5757', '#00c7be', '#f2c94c', '#B6C2CE'];

export function horizonColorFor(label: string, known: { label: string; color: string }[]): string {
  const hit = known.find((h) => h.label === label);
  if (hit) return hit.color;
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return FALLBACK_HORIZON_COLORS[Math.abs(hash) % FALLBACK_HORIZON_COLORS.length];
}
