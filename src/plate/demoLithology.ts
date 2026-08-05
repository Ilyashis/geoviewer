import type { LithoInterval, LithoPattern, Well } from '../types';

/** Domain lithology palette (from correlation/texture + a few classics). */
const LITHOS: { color: string; pattern: LithoPattern; name: string }[] = [
  { color: '#A7F0BA', pattern: 'brick', name: 'Limestone' },
  { color: '#F178B6', pattern: 'dash', name: 'Sandstone' },
  { color: '#F4693B', pattern: 'brick', name: 'Dolomite' },
  { color: '#C9A7F0', pattern: 'dots', name: 'Siltstone' },
  { color: '#3DDBD9', pattern: 'brick', name: 'Siltstone' },
  { color: '#3E6BF0', pattern: 'diag', name: 'Shale' },
  { color: '#FF9500', pattern: 'dash', name: 'Marl' },
  { color: '#E6C84B', pattern: 'dots', name: 'Argillite' },
  { color: '#4FD8C4', pattern: 'dash', name: 'Chalk' },
  { color: '#9AA0A6', pattern: 'brick', name: 'Mudstone' },
];

/** Domain saturation palette. */
const SATS: { color: string; name: string }[] = [
  { color: '#F44336', name: 'Oil' },
  { color: '#FF8389', name: 'Oil+Gas' },
  { color: '#FFCA28', name: 'Gas+Oil' },
  { color: '#FFF69D', name: 'Gas' },
  { color: '#B8E2FC', name: 'Water' },
  { color: '#BCAAA4', name: 'Product' },
  { color: '#FFCC80', name: 'Possible product' },
  { color: '#E9EBF1', name: 'Non-collector' },
];

/** Deterministic pseudo-random from a seed, for stable demo output. */
function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate plausible lithology + saturation intervals across a well's depth
 * range. Synthetic — a stand-in until real lithology import exists.
 */
export function generateDemoLithology(well: Well, seed = 1): LithoInterval[] {
  const depths = well.depth.filter(Number.isFinite);
  if (depths.length < 2) return [];
  const top = Math.min(...depths);
  const bottom = Math.max(...depths);

  const rnd = mulberry(seed * 977 + Math.round(top));
  const out: LithoInterval[] = [];
  let d = top;
  let i = 0;
  while (d < bottom) {
    const thickness = 4 + rnd() * 14;
    const base = Math.min(bottom, d + thickness);
    const lith = LITHOS[Math.floor(rnd() * LITHOS.length)];
    const sat = rnd() > 0.35 ? SATS[Math.floor(rnd() * SATS.length)] : undefined;
    out.push({
      top: d, base, color: lith.color, pattern: lith.pattern, litho: lith.name,
      sat: sat?.color, satName: sat?.name,
    });
    d = base;
    i++;
    if (i > 200) break;
  }
  return out;
}
