import type { SeismicSection } from './section';
import type { FieldSection } from './field';
import type { ControlPoint } from '../core/framework';

/** Depth (m) for a two-way time at a constant velocity — inverse of the field's depth→TWT. */
export const twtToDepth = (twtMs: number, v: number) => (twtMs * v) / 2 / 1000;

/**
 * Auto-track a reflector from a seed TWT: at each trace follow the strongest
 * positive amplitude (peak/red reflector) within a window of the previous
 * trace's time. Returns TWT (ms) per trace.
 */
export function autoTrackHorizon(section: SeismicSection, seedTwt: number, windowMs = 26): Float64Array {
  const { nTraces, nSamples, dt, t0, amp } = section;
  const win = Math.max(1, Math.round(windowMs / dt));
  const out = new Float64Array(nTraces);
  let prev = Math.round((seedTwt - t0) / dt);
  prev = Math.max(0, Math.min(nSamples - 1, prev));
  for (let i = 0; i < nTraces; i++) {
    let best = prev, bestV = -Infinity;
    for (let s = Math.max(0, prev - win); s <= Math.min(nSamples - 1, prev + win); s++) {
      const val = amp[i * nSamples + s];
      if (val > bestV) { bestV = val; best = s; }
    }
    out[i] = t0 + best * dt;
    prev = best;
  }
  return out;
}

/** An editable horizon node: a trace index and its TWT (ms). */
export interface HorizonNode { i: number; twt: number }

/** Sample a per-trace horizon down to `count` evenly-spaced editable nodes. */
export function sampleNodes(horizonTwt: Float64Array, count: number): HorizonNode[] {
  const n = horizonTwt.length;
  const nodes: HorizonNode[] = [];
  for (let k = 0; k < count; k++) {
    const i = count > 1 ? Math.round((k / (count - 1)) * (n - 1)) : 0;
    nodes.push({ i, twt: horizonTwt[i] });
  }
  return nodes;
}

/** Rebuild the per-trace horizon by linear interpolation between (edited) nodes. */
export function interpolateHorizon(nodes: HorizonNode[], nTraces: number): Float64Array {
  const out = new Float64Array(nTraces);
  const ns = [...nodes].sort((a, b) => a.i - b.i);
  if (ns.length === 0) return out;
  for (let t = 0; t < nTraces; t++) {
    if (t <= ns[0].i) { out[t] = ns[0].twt; continue; }
    if (t >= ns[ns.length - 1].i) { out[t] = ns[ns.length - 1].twt; continue; }
    let j = 0;
    while (j < ns.length - 1 && ns[j + 1].i < t) j++;
    const a = ns[j], b = ns[j + 1];
    out[t] = b.i === a.i ? a.twt : a.twt + (b.twt - a.twt) * ((t - a.i) / (b.i - a.i));
  }
  return out;
}

/** A tracked horizon (TWT per trace) → depth control points along the line (any source). */
export function horizonControls(field: FieldSection, horizonTwt: Float64Array): ControlPoint[] {
  const { line, section, velocity } = field;
  const n = section.nTraces;
  const out: ControlPoint[] = [];
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0;
    out.push({
      x: line.p0.x + f * (line.p1.x - line.p0.x),
      y: line.p0.y + f * (line.p1.y - line.p0.y),
      z: twtToDepth(horizonTwt[i], velocity),
    });
  }
  return out;
}
