import type { LithoPattern } from '../types';

/** Map a lithology-type name (RU/EN) to a domain colour + fill pattern. */
const LITHO_DEFS: { re: RegExp; color: string; pattern: LithoPattern }[] = [
  { re: /sand|песчан|песок/i, color: '#F0D264', pattern: 'dots' },
  { re: /silt|алевро/i, color: '#3DDBD9', pattern: 'brick' },
  { re: /clay|shale|argill|глин|аргиллит|сланец/i, color: '#9AA0A6', pattern: 'diag' },
  { re: /lime|известн|карбонат/i, color: '#A7F0BA', pattern: 'brick' },
  { re: /dolom|доломит/i, color: '#C9A7F0', pattern: 'dots' },
  { re: /marl|мергел/i, color: '#9EF0F0', pattern: 'dash' },
  { re: /coal|угол/i, color: '#3A3F45', pattern: 'solid' },
  { re: /gyps|anhydr|ангидрит|гипс/i, color: '#E9EBF1', pattern: 'dash' },
  { re: /salt|соль|галит/i, color: '#FCE4EC', pattern: 'diag' },
  { re: /mud|ил\b/i, color: '#BCAAA4', pattern: 'diag' },
];

const PATTERNS: LithoPattern[] = ['solid', 'diag', 'brick', 'dots', 'dash'];

/** Stable fallback colour/pattern for an unknown lithology name. */
function fallback(name: string): { color: string; pattern: LithoPattern } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return { color: `hsl(${hue} 45% 62%)`, pattern: PATTERNS[Math.abs(h >> 3) % PATTERNS.length] };
}

export function mapLithology(name: string): { color: string; pattern: LithoPattern } {
  for (const d of LITHO_DEFS) if (d.re.test(name)) return { color: d.color, pattern: d.pattern };
  return fallback(name.trim() || 'litho');
}

/** Map a saturation/fluid name (RU/EN) to a domain colour, if recognised. */
const SAT_DEFS: { re: RegExp; color: string }[] = [
  { re: /oil\s*\+\s*gas|gas\s*\+\s*oil|нефть\s*\+\s*газ|газонефт/i, color: '#FF8389' },
  { re: /oil|нефть|нефтен/i, color: '#F44336' },
  { re: /condens|конденсат/i, color: '#FFCA28' },
  { re: /gas|газ/i, color: '#FFF69D' },
  { re: /water|вода|водонас/i, color: '#B8E2FC' },
  { re: /non-?collector|неколлектор/i, color: '#E9EBF1' },
];

export function mapSaturation(name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const d of SAT_DEFS) if (d.re.test(name)) return d.color;
  return undefined;
}
