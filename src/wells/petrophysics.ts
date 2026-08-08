import type { Curve, Well } from '../types';

/** Petrophysical cutoffs + parameters for zone net-pay evaluation. */
export interface PetroParams {
  vshCut: number; // net if Vsh < vshCut
  phiCut: number; // net if φ > phiCut
  swCut: number;  // pay if Sw < swCut
  rhoMa: number;  // matrix density (density porosity)
  rhoFl: number;  // fluid density
  dtMa: number;   // matrix transit time, µs/ft (sonic porosity)
  dtFl: number;   // fluid transit time, µs/ft
  rw: number;     // formation water resistivity (Archie)
  a: number; m: number; n: number; // Archie constants
}

export const DEFAULT_PETRO: PetroParams = {
  vshCut: 0.5, phiCut: 0.08, swCut: 0.6, rhoMa: 2.65, rhoFl: 1.0,
  dtMa: 55.5, dtFl: 189, // sandstone / water, Wyllie
  rw: 0.05, a: 1, m: 2, n: 2,
};

const US_PER_FT_PER_US_PER_M = 0.3048; // µs/m → µs/ft

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Linear GR shale index. */
export function vshaleFromGR(gr: number, grMin: number, grMax: number): number {
  if (!(grMax > grMin)) return 0;
  return clamp((gr - grMin) / (grMax - grMin), 0, 1);
}

/** Density porosity. */
export function densityPorosity(rhob: number, rhoMa: number, rhoFl: number): number {
  if (!(rhoMa > rhoFl)) return 0;
  return clamp((rhoMa - rhob) / (rhoMa - rhoFl), 0, 0.6);
}

/** Archie water saturation. */
export function archieSw(phi: number, rt: number, p: PetroParams): number {
  if (phi <= 0 || rt <= 0) return 1;
  const sw = Math.pow((p.a * p.rw) / (Math.pow(phi, p.m) * rt), 1 / p.n);
  return clamp(sw, 0, 1);
}

/** Wyllie time-average sonic porosity. `dt` and the constants are all µs/ft. */
export function sonicPorosity(dt: number, dtMa: number, dtFl: number): number {
  if (!(dtFl > dtMa)) return 0;
  return clamp((dt - dtMa) / (dtFl - dtMa), 0, 0.6);
}

// --- Curve resolution -------------------------------------------------------
// Mnemonics follow two schools: Western (GR/RHOB/RESD) and Russian (ГК/ГГКП/БК),
// the latter often transliterated (GK, BK, NKT). Order matters where several
// curves could serve: a DEEP resistivity must win over a micro/shallow one,
// which reads the flushed zone and would understate Sw.

const percentile = (values: (number | null)[], p: number): number | null => {
  const f = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  return f.length ? f[Math.floor(p * (f.length - 1))] : null;
};

const GR_RE = /^(gr|gk|гк|sgr|cgr|grd|gamma)/i;         // NOT ГГК — that's density
const RHOB_RE = /^(rhob|rhoz|rhb|den|dens|ggkp|ггкп|ggk|ггк)/i;
const RES_DEEP_RE = /^(resd|rt|rd|ild|lld|at90|res|bk|бк|ik|ик|il|ил)/i;
const RES_MICRO_RE = /^(mbk|мбк|bmk|бмк|msfl|mll|sfl|msf|mnk|мнк)/i;
const DT_RE = /^(dt|dtp|dtco|ak|ак|sonic)/i;
const PHI_RE = /^(nphi|phit|phie|phi|poro|por|kp|кп|nkt|нкт)/i;

/** How porosity was obtained — surfaced so the geologist sees the method, not a black box. */
export type PhiMethod = 'density' | 'sonic' | 'direct' | 'none';

export interface CurvePick {
  gr?: Curve;
  res?: Curve;
  phiCurve?: Curve;
  phiMethod: PhiMethod;
  /** True when a µs/ft-labelled sonic was actually µs/m and had to be rescaled. */
  dtRescaled?: boolean;
}

/**
 * Choose the curves to evaluate a well with.
 *
 * Values are trusted over unit labels, because real exports mislabel them: a
 * neutron curve tagged `m3/m3` whose values reach 3.5 is not porosity, and a
 * sonic tagged `us/ft` reading 280 is really µs/m. Accepting either at face
 * value yields confident nonsense (porosity above 100%), so each is validated
 * against the range the quantity can physically occupy.
 */
export function pickCurves(well: Well): CurvePick {
  const find = (re: RegExp) => well.curves.find((c) => re.test(c.mnemonic));

  const gr = find(GR_RE);
  const res = well.curves.find((c) => RES_DEEP_RE.test(c.mnemonic) && !RES_MICRO_RE.test(c.mnemonic))
    ?? find(RES_MICRO_RE); // micro only as a last resort

  // 1. A genuine porosity curve — accepted only if it looks like a fraction.
  const direct = find(PHI_RE);
  if (direct) {
    const hi = percentile(direct.values, 0.95);
    if (hi != null && hi > 0 && hi <= 1) return { gr, res, phiCurve: direct, phiMethod: 'direct' };
  }

  // 2. Density porosity.
  const rhob = find(RHOB_RE);
  if (rhob) return { gr, res, phiCurve: rhob, phiMethod: 'density' };

  // 3. Sonic (Wyllie). µs/ft rock spans ~40–190, µs/m ~130–620; a median above
  //    190 cannot be µs/ft at all, so the label loses to the data.
  const dt = find(DT_RE);
  if (dt) {
    const med = percentile(dt.values, 0.5);
    const labelledMetric = /m\b|м/i.test(dt.unit ?? '') && !/ft|фут/i.test(dt.unit ?? '');
    const dtRescaled = med != null ? med > 200 : labelledMetric;
    return { gr, res, phiCurve: dt, phiMethod: 'sonic', dtRescaled };
  }

  return { gr, res, phiMethod: 'none' };
}

export interface ZoneStats {
  gross: number; net: number; ng: number; phi: number; sw: number; netSamples: number;
  /** Which curves/method produced this — for display, so the number is auditable. */
  pick: CurvePick;
}

/**
 * Net-pay stats for one well over the MD interval [top, base]:
 * Vsh (from GR), φ (density / sonic / direct — whichever the well supports),
 * Sw (Archie); a sample is net-pay when Vsh<cut, φ>cut, Sw<cut. Returns null
 * if the well can't supply GR, a resistivity and some porosity source.
 */
export function zoneStats(well: Well, top: number, base: number, p: PetroParams): ZoneStats | null {
  const pick = pickCurves(well);
  const { gr, res, phiCurve } = pick;
  if (!gr || !res || !phiCurve || pick.phiMethod === 'none' || well.depth.length < 2) return null;

  const lo = Math.min(top, base), hi = Math.max(top, base);
  const step = Math.abs(well.depth[1] - well.depth[0]) || 0.1;

  // Auto GR baselines over the zone (clean → shale).
  let grMin = Infinity, grMax = -Infinity;
  for (let i = 0; i < well.depth.length; i++) {
    const d = well.depth[i];
    if (d < lo || d > hi) continue;
    const g = gr.values[i];
    if (g == null || !Number.isFinite(g)) continue;
    if (g < grMin) grMin = g;
    if (g > grMax) grMax = g;
  }

  // Porosity from whichever source this well actually has.
  const porosityAt = (v: number): number => {
    switch (pick.phiMethod) {
      case 'density': return densityPorosity(v, p.rhoMa, p.rhoFl);
      case 'sonic': return sonicPorosity(pick.dtRescaled ? v * US_PER_FT_PER_US_PER_M : v, p.dtMa, p.dtFl);
      default: return clamp(v, 0, 0.6); // already a fraction
    }
  };

  let gross = 0, net = 0, phiSum = 0, swSum = 0, netSamples = 0;
  for (let i = 0; i < well.depth.length; i++) {
    const d = well.depth[i];
    if (d < lo || d > hi) continue;
    const g = gr.values[i], pv = phiCurve.values[i], rt = res.values[i];
    if (g == null || pv == null || rt == null) continue;
    gross += step;
    const vsh = vshaleFromGR(g, grMin, grMax);
    const phi = porosityAt(pv);
    const sw = archieSw(phi, rt, p);
    if (vsh < p.vshCut && phi > p.phiCut && sw < p.swCut) {
      net += step; phiSum += phi; swSum += sw; netSamples++;
    }
  }

  return {
    gross, net,
    ng: gross > 0 ? net / gross : 0,
    phi: netSamples ? phiSum / netSamples : 0,
    sw: netSamples ? swSum / netSamples : 0,
    netSamples,
    pick,
  };
}

export interface ZoneAggregate {
  ng: number; phi: number; sw: number; wellsUsed: number;
  /** How φ was obtained across the wells used, and which curves fed it. */
  phiMethod: PhiMethod;
  curves: string;
}

/** Field-average net-pay stats over a zone: net-weighted φ/Sw, aggregate N/G. */
export function aggregateZone(
  wells: Well[], topDepth: (w: Well) => number | undefined, baseDepth: (w: Well) => number | undefined, p: PetroParams,
): ZoneAggregate | null {
  let gGross = 0, gNet = 0, phiW = 0, swW = 0, used = 0;
  const methods = new Set<PhiMethod>();
  const mnemonics = new Set<string>();
  for (const w of wells) {
    const t = topDepth(w), b = baseDepth(w);
    if (t == null || b == null || !Number.isFinite(t) || !Number.isFinite(b)) continue;
    const s = zoneStats(w, t, b, p);
    if (!s || s.gross <= 0) continue;
    gGross += s.gross; gNet += s.net; phiW += s.phi * s.net; swW += s.sw * s.net; used++;
    methods.add(s.pick.phiMethod);
    for (const m of [s.pick.gr?.mnemonic, s.pick.res?.mnemonic, s.pick.phiCurve?.mnemonic]) if (m) mnemonics.add(m);
  }
  if (used === 0 || gGross <= 0) return null;
  return {
    ng: gNet / gGross,
    phi: gNet > 0 ? phiW / gNet : 0,
    sw: gNet > 0 ? swW / gNet : 0,
    wellsUsed: used,
    phiMethod: methods.size === 1 ? [...methods][0] : 'none',
    curves: [...mnemonics].join(', '),
  };
}
