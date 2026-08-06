import type { Grid } from './grid';

/** Deterministic (single-scenario) volumetric parameters for an oil zone. */
export interface VolParams {
  ng: number;   // net-to-gross (0..1)
  phi: number;  // porosity (0..1)
  sw: number;   // water saturation (0..1)
  bo: number;   // oil formation volume factor (rm³/sm³)
  rf: number;   // recovery factor (0..1)
}

export interface VolResult {
  areaKm2: number;
  meanThickness: number;
  grossM3: number;   // gross rock volume
  netM3: number;     // net rock volume
  poreM3: number;    // pore volume
  hcpvM3: number;    // hydrocarbon pore volume (reservoir)
  stooipM3: number;  // stock-tank oil in place (surface, m³)
  stooipBbl: number; // STOOIP in barrels
  recoverableBbl: number;
}

const M3_TO_BBL = 6.289810;

/**
 * Volumetrics from an isochore (thickness) grid: integrate thickness over the
 * mapped area for gross rock volume, then apply N/G · φ · (1−Sw) · 1/Bo.
 * Cell area uses the grid's dx·dy (data coordinate units, assumed metres).
 */
export function volumetrics(grid: Grid, p: VolParams): VolResult {
  const cellArea = grid.dx * grid.dy;
  let gross = 0;
  let area = 0;
  for (let k = 0; k < grid.z.length; k++) {
    const th = grid.z[k];
    if (th > 0) { gross += th * cellArea; area += cellArea; }
  }
  const net = gross * p.ng;
  const pore = net * p.phi;
  const hcpv = pore * (1 - p.sw);
  const stooipM3 = p.bo > 0 ? hcpv / p.bo : 0;
  const stooipBbl = stooipM3 * M3_TO_BBL;
  return {
    areaKm2: area / 1e6,
    meanThickness: area > 0 ? gross / area : 0,
    grossM3: gross,
    netM3: net,
    poreM3: pore,
    hcpvM3: hcpv,
    stooipM3,
    stooipBbl,
    recoverableBbl: stooipBbl * p.rf,
  };
}

export const DEFAULT_VOL_PARAMS: VolParams = { ng: 0.6, phi: 0.2, sw: 0.3, bo: 1.2, rf: 0.3 };
