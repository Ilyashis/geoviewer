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

/**
 * Does this curve carry a 0…1 fraction? Judged on the values, never the unit:
 * real files label К_п as `%` while storing 0.24, and label a neutron curve
 * `m3/m3` while storing 3.5. A high percentile rather than the maximum keeps a
 * single spike from disqualifying a good curve, and a curve that is zero
 * everywhere carries nothing to use.
 */
function fraction(c: Curve): boolean {
  const hi = percentile(c.values, 0.99);
  if (hi == null || hi > 1) return false;
  return c.values.some((v) => v != null && Number.isFinite(v) && v > 0);
}

const GR_RE = /^(gr|gk|гк|sgr|cgr|grd|gamma)/i;         // NOT ГГК — that's density
const RHOB_RE = /^(rhob|rhoz|rhb|den|dens|ggkp|ггкп|ggk|ггк)/i;
const RES_DEEP_RE = /^(resd|rt|rd|ild|lld|at90|res|bk|бк|ik|ик|il|ил)/i;
const RES_MICRO_RE = /^(mbk|мбк|bmk|бмк|msfl|mll|sfl|msf|mnk|мнк)/i;
const DT_RE = /^(dt|dtp|dtco|ak|ак|sonic)/i;
const PHI_RE = /^(nphi|phit|phie|phi|poro|por|kp|кп|nkt|нкт)/i;

/**
 * A delivered interpretation, as Russian projects normally ship it: the
 * petrophysicist's own К_п, К_гл, К_нг and the reservoir flag К_кол, computed
 * with core calibration and local knowledge that no generic transform here can
 * reproduce. Where these exist they are the answer, not an input to one.
 *
 * Anchored deliberately. `rp` is ρ_п, the interpreted formation resistivity,
 * but `RPCHX` is a raw tool channel; `kng` is hydrocarbon saturation while the
 * neighbouring `К_во` is *irreducible* water and would badly understate Sw if
 * mistaken for the current value.
 */
const RES_INTERP_RE = /^(rp|рп)$/i;
const VSH_INTERP_RE = /^(kgl|кгл|vsh|vcl|vshale)$/i;
/** α_ПС: 1 in clean sand, 0 in shale — the inverse of a shale index. */
const APS_RE = /^(aps|апс|alphaps|альфапс)$/i;
/** Hydrocarbon saturation, so Sw = 1 − v. Never К_во (irreducible water). */
const SW_HC_RE = /^(kng|кнг|kn|кн|sng|снг)$/i;
const SW_W_RE = /^(sw|swt|swe|kv|кв)$/i;
/** Reservoir flag, 0/1. */
const NET_FLAG_RE = /^(kol|кол|collector|коллектор|net)$/i;

/** How porosity was obtained — surfaced so the geologist sees the method, not a black box. */
export type PhiMethod = 'density' | 'sonic' | 'direct' | 'none';

/** Where the shale fraction came from. */
export type VshSource = 'gr' | 'kgl' | 'aps' | 'none';
/** Where water saturation came from. */
export type SwSource = 'archie' | 'kng' | 'sw' | 'none';
/** How a sample was judged to be reservoir. */
export type NetSource = 'cutoffs' | 'flag';

export interface CurvePick {
  gr?: Curve;
  res?: Curve;
  phiCurve?: Curve;
  phiMethod: PhiMethod;
  /** True when a µs/ft-labelled sonic was actually µs/m and had to be rescaled. */
  dtRescaled?: boolean;
  vshCurve?: Curve;
  vshSource: VshSource;
  swCurve?: Curve;
  swSource: SwSource;
  netFlag?: Curve;
  netSource: NetSource;
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
  // ρ_п is the interpreted formation resistivity — already corrected for
  // invasion and borehole, so it beats any raw curve when the file carries it.
  const res = find(RES_INTERP_RE)
    ?? well.curves.find((c) => RES_DEEP_RE.test(c.mnemonic) && !RES_MICRO_RE.test(c.mnemonic))
    ?? find(RES_MICRO_RE); // micro only as a last resort

  // Shale fraction: the interpreter's own К_гл first, then α_ПС (which runs the
  // other way — 1 in clean sand), and only then a GR transform.
  const kgl = find(VSH_INTERP_RE);
  const aps = find(APS_RE);
  const [vshCurve, vshSource]: [Curve | undefined, VshSource] =
    kgl && fraction(kgl) ? [kgl, 'kgl']
    : aps && fraction(aps) ? [aps, 'aps']
    : gr ? [undefined, 'gr'] : [undefined, 'none'];

  // Saturation: delivered К_нг (hydrocarbon, so Sw = 1 − v) or Sw itself,
  // otherwise Archie from φ and resistivity.
  const kng = find(SW_HC_RE), swc = find(SW_W_RE);
  const [swCurve, swSource]: [Curve | undefined, SwSource] =
    kng && fraction(kng) ? [kng, 'kng']
    : swc && fraction(swc) ? [swc, 'sw']
    : res ? [undefined, 'archie'] : [undefined, 'none'];

  const netFlag = find(NET_FLAG_RE);
  const netSource: NetSource = netFlag ? 'flag' : 'cutoffs';
  const common = { gr, res, vshCurve, vshSource, swCurve, swSource, netFlag, netSource };

  // 1. A genuine porosity curve — accepted only if it looks like a fraction.
  //    Every candidate is tried: a well carrying both NKT (which is not
  //    porosity at all) and К_п must not lose К_п to whichever comes first.
  for (const c of well.curves.filter((x) => PHI_RE.test(x.mnemonic))) {
    if (fraction(c)) return { ...common, phiCurve: c, phiMethod: 'direct' };
  }

  // 2. Density porosity.
  const rhob = find(RHOB_RE);
  if (rhob) return { ...common, phiCurve: rhob, phiMethod: 'density' };

  // 3. Sonic (Wyllie). µs/ft rock spans ~40–190, µs/m ~130–620; a median above
  //    190 cannot be µs/ft at all, so the label loses to the data.
  const dt = find(DT_RE);
  if (dt) {
    const med = percentile(dt.values, 0.5);
    const labelledMetric = /m\b|м/i.test(dt.unit ?? '') && !/ft|фут/i.test(dt.unit ?? '');
    const dtRescaled = med != null ? med > 200 : labelledMetric;
    return { ...common, phiCurve: dt, phiMethod: 'sonic', dtRescaled };
  }

  return { ...common, phiMethod: 'none' };
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
  const { gr, res, phiCurve, vshCurve, swCurve, netFlag } = pick;
  if (!phiCurve || pick.phiMethod === 'none' || well.depth.length < 2) return null;
  // Each decision needs *a* source, but which one differs: a raw-log well needs
  // GR and a resistivity, while a well delivered with К_кол and К_нг needs
  // neither. Demanding both, as this once did, threw away exactly the wells
  // that arrive already interpreted.
  if (pick.netSource === 'cutoffs' && !vshCurve && !gr) return null;
  if (pick.swSource === 'none') return null;

  const lo = Math.min(top, base), hi = Math.max(top, base);
  const step = Math.abs(well.depth[1] - well.depth[0]) || 0.1;

  // Auto GR baselines over the zone (clean → shale).
  let grMin = Infinity, grMax = -Infinity;
  if (gr) {
    for (let i = 0; i < well.depth.length; i++) {
      const d = well.depth[i];
      if (d < lo || d > hi) continue;
      const g = gr.values[i];
      if (g == null || !Number.isFinite(g)) continue;
      if (g < grMin) grMin = g;
      if (g > grMax) grMax = g;
    }
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

    const flagV = netFlag?.values[i], vshV = vshCurve?.values[i], grV = gr?.values[i];
    // Gross counts the rock we could actually judge. It must not be tied to the
    // porosity curve: an interpreted К_п exists only inside reservoirs, so
    // counting gross where φ exists would make N/G exactly 1 every time.
    const decidable = pick.netSource === 'flag' ? flagV != null
      : vshCurve ? vshV != null : grV != null;
    if (!decidable) continue;
    gross += step;

    let reservoir: boolean;
    if (pick.netSource === 'flag') {
      reservoir = flagV! > 0.5;
    } else {
      // α_ПС runs the other way from a shale index: 1 is clean sand.
      const vsh = vshCurve
        ? clamp(pick.vshSource === 'aps' ? 1 - vshV! : vshV!, 0, 1)
        : vshaleFromGR(grV!, grMin, grMax);
      reservoir = vsh < p.vshCut;
    }
    if (!reservoir) continue;

    const pv = phiCurve.values[i];
    if (pv == null) continue; // reservoir, but nothing to say how porous
    const phi = porosityAt(pv);
    // The interpreter's flag already embodies their cutoffs; applying ours on
    // top would quietly re-filter their answer.
    if (pick.netSource === 'cutoffs' && !(phi > p.phiCut)) continue;

    let sw: number;
    if (swCurve) {
      const sv = swCurve.values[i];
      if (sv == null) continue;
      sw = clamp(pick.swSource === 'kng' ? 1 - sv : sv, 0, 1);
    } else {
      const rt = res!.values[i];
      if (rt == null) continue;
      sw = archieSw(phi, rt, p);
    }
    if (sw >= p.swCut) continue;

    net += step; phiSum += phi; swSum += sw; netSamples++;
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
  /**
   * How many of those wells were counted from a delivered interpretation —
   * the petrophysicist's own reservoir flag — rather than from our cutoffs.
   * Worth showing: the two answer to different authorities.
   */
  interpreted: number;
}

/** Field-average net-pay stats over a zone: net-weighted φ/Sw, aggregate N/G. */
export function aggregateZone(
  wells: Well[], topDepth: (w: Well) => number | undefined, baseDepth: (w: Well) => number | undefined, p: PetroParams,
): ZoneAggregate | null {
  let gGross = 0, gNet = 0, phiW = 0, swW = 0, used = 0, interpreted = 0;
  const methods = new Set<PhiMethod>();
  const mnemonics = new Set<string>();
  for (const w of wells) {
    const t = topDepth(w), b = baseDepth(w);
    if (t == null || b == null || !Number.isFinite(t) || !Number.isFinite(b)) continue;
    const s = zoneStats(w, t, b, p);
    if (!s || s.gross <= 0) continue;
    gGross += s.gross; gNet += s.net; phiW += s.phi * s.net; swW += s.sw * s.net; used++;
    if (s.pick.netSource === 'flag') interpreted++;
    methods.add(s.pick.phiMethod);
    for (const m of [s.pick.gr?.mnemonic, s.pick.res?.mnemonic, s.pick.phiCurve?.mnemonic,
                     s.pick.swCurve?.mnemonic, s.pick.netFlag?.mnemonic]) if (m) mnemonics.add(m);
  }
  if (used === 0 || gGross <= 0) return null;
  return {
    ng: gNet / gGross,
    phi: gNet > 0 ? phiW / gNet : 0,
    sw: gNet > 0 ? swW / gNet : 0,
    wellsUsed: used,
    phiMethod: methods.size === 1 ? [...methods][0] : 'none',
    curves: [...mnemonics].join(', '),
    interpreted,
  };
}
