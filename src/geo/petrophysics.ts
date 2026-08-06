import type { Well } from '../types';

/** Petrophysical cutoffs + parameters for zone net-pay evaluation. */
export interface PetroParams {
  vshCut: number; // net if Vsh < vshCut
  phiCut: number; // net if φ > phiCut
  swCut: number;  // pay if Sw < swCut
  rhoMa: number;  // matrix density (density porosity)
  rhoFl: number;  // fluid density
  rw: number;     // formation water resistivity (Archie)
  a: number; m: number; n: number; // Archie constants
}

export const DEFAULT_PETRO: PetroParams = {
  vshCut: 0.5, phiCut: 0.08, swCut: 0.6, rhoMa: 2.65, rhoFl: 1.0, rw: 0.05, a: 1, m: 2, n: 2,
};

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

export interface ZoneStats {
  gross: number; net: number; ng: number; phi: number; sw: number; netSamples: number;
}

const CURVE_RE = {
  gr: /^(gr|cgr|sgr|grd)/i,
  rhob: /^(rhob|den|rhoz|rhb)/i,
  res: /^(resd|rt|rd|ild|lld|res|at90)/i,
};

function findCurve(well: Well, re: RegExp) {
  return well.curves.find((c) => re.test(c.mnemonic));
}

/**
 * Net-pay stats for one well over the MD interval [top, base]:
 * Vsh (from GR), φ (density), Sw (Archie); a sample is net-pay when
 * Vsh<cut, φ>cut, Sw<cut. Returns null if the required curves are absent.
 */
export function zoneStats(well: Well, top: number, base: number, p: PetroParams): ZoneStats | null {
  const gr = findCurve(well, CURVE_RE.gr);
  const rhob = findCurve(well, CURVE_RE.rhob);
  const res = findCurve(well, CURVE_RE.res);
  if (!gr || !rhob || !res || well.depth.length < 2) return null;

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

  let gross = 0, net = 0, phiSum = 0, swSum = 0, netSamples = 0;
  for (let i = 0; i < well.depth.length; i++) {
    const d = well.depth[i];
    if (d < lo || d > hi) continue;
    const g = gr.values[i], rb = rhob.values[i], rt = res.values[i];
    if (g == null || rb == null || rt == null) continue;
    gross += step;
    const vsh = vshaleFromGR(g, grMin, grMax);
    const phi = densityPorosity(rb, p.rhoMa, p.rhoFl);
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
  };
}

export interface ZoneAggregate { ng: number; phi: number; sw: number; wellsUsed: number }

/** Field-average net-pay stats over a zone: net-weighted φ/Sw, aggregate N/G. */
export function aggregateZone(
  wells: Well[], topDepth: (w: Well) => number | undefined, baseDepth: (w: Well) => number | undefined, p: PetroParams,
): ZoneAggregate | null {
  let gGross = 0, gNet = 0, phiW = 0, swW = 0, used = 0;
  for (const w of wells) {
    const t = topDepth(w), b = baseDepth(w);
    if (t == null || b == null || !Number.isFinite(t) || !Number.isFinite(b)) continue;
    const s = zoneStats(w, t, b, p);
    if (!s || s.gross <= 0) continue;
    gGross += s.gross; gNet += s.net; phiW += s.phi * s.net; swW += s.sw * s.net; used++;
  }
  if (used === 0 || gGross <= 0) return null;
  return { ng: gNet / gGross, phi: gNet > 0 ? phiW / gNet : 0, sw: gNet > 0 ? swW / gNet : 0, wellsUsed: used };
}
