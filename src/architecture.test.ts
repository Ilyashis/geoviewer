import { describe, it, expect } from 'vitest';

/**
 * Architecture guard: enforces the module layering so boundaries don't rot as
 * the app grows.
 *
 *   core  ←  wells ∥ seismic  ←  reserves      (arrows = "may import")
 *
 * - `core` is the shared kernel — a leaf: it imports nothing outside itself.
 * - Feature modules import core (and the shared `types`/`util`), never UI, the
 *   store, exporters or the app shell. `wells` and `seismic` are peers (neither
 *   imports the other); `reserves` builds on `wells`, not vice versa.
 *
 * Unlisted top-level dirs (components, export, las, store, plate…) are the UI /
 * app shell and not-yet-modularised adapters — left unconstrained for now.
 * Source is read via Vite's import.meta.glob, so there's no extra tooling.
 */

const files = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const RE = /(?:import|export)\b[^;'"]*\bfrom\s*['"](\.[^'"]+)['"]/g;

/** Resolve a relative import to a path relative to the src root. */
function resolveFrom(fromPath: string, spec: string): string {
  const segs = fromPath.replace(/^\.\//, '').split('/');
  segs.pop(); // drop filename → directory
  for (const s of spec.split('/')) {
    if (s === '..') segs.pop();
    else if (s && s !== '.') segs.push(s);
  }
  return segs.join('/');
}

const moduleOf = (srcRelPath: string) => srcRelPath.replace(/^\.\//, '').split('/')[0];

// Allowed import targets (top-level modules) per constrained module.
const RULES: Record<string, Set<string>> = {
  core: new Set(['core']),
  wells: new Set(['core', 'wells', 'types', 'util']),
  seismic: new Set(['core', 'seismic', 'types', 'util']),
  reserves: new Set(['core', 'reserves', 'wells', 'types', 'util']),
};

describe('module boundaries', () => {
  it('keeps the layering: core ← wells ← reserves, features stay pure', () => {
    expect(Object.keys(files).length).toBeGreaterThan(20); // guard: the glob found files
    const violations: string[] = [];
    for (const [path, src] of Object.entries(files)) {
      const allowed = RULES[moduleOf(path)];
      if (!allowed) continue; // unconstrained (UI / app shell / adapters)
      for (const m of src.matchAll(RE)) {
        const targetMod = moduleOf(resolveFrom(path, m[1]));
        if (!allowed.has(targetMod)) violations.push(`${path} → ${m[1]}  [${targetMod}]`);
      }
    }
    expect(violations).toEqual([]);
  });
});
