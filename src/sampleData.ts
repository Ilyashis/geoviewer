/**
 * A synthetic but realistic demo LAS, generated at module load so the app has
 * something to show without a file on disk. Includes GR, resistivity (log),
 * neutron porosity and bulk density across a depth interval, with a few NULLs.
 *
 * `seed` varies the curves per well (sand positions, GR baseline, resistivity
 * amplitude, phase) so a demo field of several wells looks distinct rather than
 * identical — good for correlation, crossplots and net-pay by zone.
 */
export function buildDemoLas(seed = 0): string {
  const start = 2000;
  const stop = 2200;
  const step = 0.5;
  const NULL = -999.25;

  const s = seed;
  const p1 = 0.30 + 0.03 * (s % 5);   // first sand centre 0.30..0.42
  const p2 = 0.62 + 0.025 * (s % 4);  // second sand centre 0.62..0.695
  const grBase = 86 + 5 * (s % 4);    // shale GR baseline 86..101
  const resAmp = 34 + 5 * (s % 5);    // resistivity amplitude in sand
  const ph = s * 1.3;

  const rows: string[] = [];
  for (let d = start; d <= stop + 1e-9; d += step) {
    const t = (d - start) / (stop - start);
    const sand =
      Math.exp(-Math.pow((t - p1) / 0.05, 2)) +
      Math.exp(-Math.pow((t - p2) / 0.07, 2));

    const gr = grBase - 55 * sand + 8 * Math.sin(d * 0.7 + ph);
    const resd = Math.max(0.5, 2 + resAmp * sand + 3 * Math.sin(d * 0.3 + s));
    const nphi = 0.32 - 0.18 * sand + 0.02 * Math.sin(d * 1.1 + s);
    const rhob = 2.35 + 0.25 * sand + 0.03 * Math.cos(d * 0.9 + s);

    // Inject a small washed-out gap in RHOB to exercise NULL handling.
    const rhobOut = d > 2090 && d < 2094 ? NULL : rhob;

    rows.push(
      [d, gr, resd, nphi, rhobOut]
        .map((v) => (v === NULL ? NULL.toFixed(4) : v.toFixed(4)))
        .join('  ')
    );
  }

  return `~Version Information
 VERS.   2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0
 WRAP.    NO : ONE LINE PER DEPTH STEP
~Well Information
 STRT.M   ${start.toFixed(4)} : START DEPTH
 STOP.M   ${stop.toFixed(4)} : STOP DEPTH
 STEP.M   ${step.toFixed(4)} : STEP
 NULL.    ${NULL.toFixed(4)} : NULL VALUE
 WELL.    ANDROMEDA-DEMO-${seed} : WELL
 UWI .    100/DEMO-${String(seed).padStart(2, '0')} : UNIQUE WELL ID
~Curve Information
 DEPT.M    : Measured depth
 GR  .GAPI : Gamma ray
 RESD.OHMM : Deep resistivity
 NPHI.V/V  : Neutron porosity
 RHOB.G/C3 : Bulk density
~ASCII
${rows.join('\n')}
`;
}

export const SAMPLE_LAS = buildDemoLas(0);
