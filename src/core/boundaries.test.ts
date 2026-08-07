import { describe, it, expect } from 'vitest';

/**
 * Architecture guard: src/core is the shared kernel — it must depend on nothing
 * outside itself. Feature modules (wells, maps, reserves, seismic…) may depend
 * ON core, never the other way round. This keeps the integration layer pure and
 * stops boundaries from rotting as the app grows. No extra tooling — it runs
 * with the normal test suite (source read via Vite's import.meta.glob).
 */

// Every core source file as raw text, keyed by path relative to this file.
const files = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// Relative specifiers in `import … from '.'` / `export … from '.'`; bare package
// imports (no leading dot) are ignored.
const RE = /(?:import|export)\b[^;'"]*\bfrom\s*['"](\.[^'"]+)['"]/g;

/** Does a relative import from `fromPath` resolve above the core root? */
function escapesCore(fromPath: string, spec: string): boolean {
  const dir = fromPath.replace(/^\.\//, '').split('/');
  dir.pop(); // → directory segments relative to the core root
  let depth = dir.length;
  for (const seg of spec.split('/')) {
    if (seg === '..') { depth--; if (depth < 0) return true; }
    else if (seg && seg !== '.') depth++;
  }
  return false;
}

describe('core boundary', () => {
  it('src/core imports nothing outside src/core (the kernel is a leaf)', () => {
    expect(Object.keys(files).length).toBeGreaterThan(5); // guard: the glob actually found files
    const violations: string[] = [];
    for (const [path, src] of Object.entries(files)) {
      if (path.endsWith('boundaries.test.ts')) continue;
      for (const m of src.matchAll(RE)) {
        if (escapesCore(path, m[1])) violations.push(`${path} → ${m[1]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
