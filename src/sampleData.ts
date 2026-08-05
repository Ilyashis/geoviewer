/**
 * A synthetic but realistic demo LAS, generated at module load so the app has
 * something to show without a file on disk. Includes GR, resistivity (log),
 * neutron porosity and bulk density across a depth interval, with a few NULLs.
 */
function buildDemoLas(): string {
  const start = 2000;
  const stop = 2200;
  const step = 0.5;
  const NULL = -999.25;

  const rows: string[] = [];
  for (let d = start; d <= stop + 1e-9; d += step) {
    const t = (d - start) / (stop - start);
    // A couple of "sand" intervals with low GR / high resistivity.
    const sand =
      Math.exp(-Math.pow((t - 0.3) / 0.05, 2)) +
      Math.exp(-Math.pow((t - 0.65) / 0.07, 2));

    const gr = 90 - 55 * sand + 8 * Math.sin(d * 0.7);
    const resd = Math.max(0.5, 2 + 40 * sand + 3 * Math.sin(d * 0.3));
    const nphi = 0.32 - 0.18 * sand + 0.02 * Math.sin(d * 1.1);
    const rhob = 2.35 + 0.25 * sand + 0.03 * Math.cos(d * 0.9);

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
 WELL.    ANDROMEDA-DEMO : WELL
 UWI .    100/DEMO-01 : UNIQUE WELL ID
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

export const SAMPLE_LAS = buildDemoLas();
