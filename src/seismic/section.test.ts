import { describe, it, expect } from 'vitest';
import { buildSyntheticSection, type Reflector } from './section';

const reflectors: Reflector[] = [
  { t0: 400, dip: 40, fold: 0, amp: 1 },
  { t0: 800, dip: -30, fold: 0, amp: -0.8 },
];
const opts = { nTraces: 60, nSamples: 300, dt: 4, t0: 0, reflectors, seed: 7 };

describe('buildSyntheticSection', () => {
  it('has the requested geometry and a normalisation peak', () => {
    const s = buildSyntheticSection(opts);
    expect(s.nTraces).toBe(60);
    expect(s.nSamples).toBe(300);
    expect(s.amp.length).toBe(60 * 300);
    expect(s.ampMax).toBeGreaterThan(0.5);
  });

  it('is reproducible for a fixed seed', () => {
    const a = buildSyntheticSection(opts), b = buildSyntheticSection(opts);
    expect(a.amp[1234]).toBe(b.amp[1234]);
    expect(a.ampMax).toBe(b.ampMax);
  });

  it('carries reflector energy near the reflector time', () => {
    const s = buildSyntheticSection({ ...opts, noise: 0 });
    // Reflector at 400 ms, trace 0 → sample 100. Energy there should beat a quiet zone.
    const nearTop = Math.abs(s.amp[0 * s.nSamples + 100]);
    const quiet = Math.abs(s.amp[0 * s.nSamples + 20]); // above the first reflector
    expect(nearTop).toBeGreaterThan(quiet);
  });
});
