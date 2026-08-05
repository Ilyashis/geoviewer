import type { Track, Well, Template } from '../types';

/**
 * Common curve families → how they should be grouped and scaled on a plate.
 * This mirrors the conventions geologists expect (GR on the left, resistivity
 * on a log scale, porosity curves together, etc.).
 */
const RESISTIVITY = /^(RES|RT|RD|RESD|RESM|RESS|ILD|ILM|LLD|LLS|SFL|MSFL)/i;
const GAMMA = /^(GR|CGR|SGR|GRD)/i;
const POROSITY = /^(NPHI|PHIN|TNPH|DPHI|PHID|RHOB|DEN)/i;
const CALIPER = /^(CAL|CALI|HCAL|DCAL)/i;
const SP = /^SP/i;

const PALETTE = ['#2b8cbe', '#e34a33', '#31a354', '#756bb1', '#d95f0e', '#c51b8a'];

let trackSeq = 0;
const nextId = () => `track-${++trackSeq}`;

/** Build a sensible default plate template from the curves present in a well. */
export function defaultTemplate(well: Well): Template {
  const tracks: Track[] = [];
  let colorIdx = 0;
  const nextColor = () => PALETTE[colorIdx++ % PALETTE.length];

  const gamma = well.curves.filter((c) => GAMMA.test(c.mnemonic) || SP.test(c.mnemonic));
  const caliper = well.curves.filter((c) => CALIPER.test(c.mnemonic));
  const resistivity = well.curves.filter((c) => RESISTIVITY.test(c.mnemonic));
  const porosity = well.curves.filter((c) => POROSITY.test(c.mnemonic));

  const used = new Set([...gamma, ...caliper, ...resistivity, ...porosity]);
  const others = well.curves.filter((c) => !used.has(c));

  if (gamma.length || caliper.length) {
    tracks.push({
      id: nextId(),
      title: 'GR / SP / Caliper',
      widthPx: 170,
      curves: [...gamma, ...caliper].map((c) => ({
        mnemonic: c.mnemonic,
        color: nextColor(),
        scale: 'linear',
      })),
    });
  }

  if (resistivity.length) {
    tracks.push({
      id: nextId(),
      title: 'Resistivity',
      widthPx: 170,
      curves: resistivity.map((c) => ({
        mnemonic: c.mnemonic,
        color: nextColor(),
        scale: 'log',
      })),
    });
  }

  if (porosity.length) {
    tracks.push({
      id: nextId(),
      title: 'Porosity / Density',
      widthPx: 170,
      curves: porosity.map((c) => ({
        mnemonic: c.mnemonic,
        color: nextColor(),
        scale: 'linear',
      })),
    });
  }

  for (const c of others) {
    tracks.push({
      id: nextId(),
      title: c.mnemonic,
      widthPx: 150,
      curves: [{ mnemonic: c.mnemonic, color: nextColor(), scale: 'linear' }],
    });
  }

  return { id: 'default', name: 'Default', tracks };
}
