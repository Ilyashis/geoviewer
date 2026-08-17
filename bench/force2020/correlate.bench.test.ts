/**
 * Correlation bench on open data (FORCE 2020 / NPD, CC BY 4.0 — see README.md
 * in this folder). `datasets/` is gitignored; run `prepare-tops.py` first.
 *
 * This is a measurement, not a pass/fail test: `src/wells/correlate.ts` isn't
 * wired to the UI, and the point of this stand is to find out whether it
 * should be — see docs/product/correlation.md for the private-data result
 * that left it unwired. Only the self-check is a hard assertion; it gates the
 * harness itself, not the correlator's real-world accuracy.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { decodeText } from '../../src/util/encoding';
import { parseLasToWell } from '../../src/las/parser';
import { parseTopsCsv } from '../../src/tops/csv';
import { parseWellHeadsCsv } from '../../src/wells/heads';
import { pickCurves } from '../../src/wells/petrophysics';
import { clusterPoints, type Cluster } from '../../src/core/geom/cluster';
import { propagatePick, isConvincing, DEFAULT_CORRELATION, type Proposal } from '../../src/wells/correlate';
import { norm } from '../../src/store/shared';
import type { Well } from '../../src/types';

const ROOT = join(__dirname, '..', '..', 'datasets', 'force2020');
const LAS_DIR = join(ROOT, 'las');
const REQUIRED = [LAS_DIR, join(ROOT, 'tops.csv'), join(ROOT, 'heads.csv')];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.las$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** Quantile of a sorted-ascending array. */
const q = (sorted: number[], f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];

const missing = REQUIRED.filter((p) => !existsSync(p));

describe.skipIf(missing.length > 0)('стенд корреляции: FORCE 2020', () => {
  if (missing.length) {
    console.log(`данные не собраны — см. bench/force2020/README.md (нет: ${missing.join(', ')})`);
  }

  // Loaded once and shared: parsing 118 LAS files (some several MB) four
  // times over, once per `it`, was most of the runtime.
  let allWells: Well[] = [];
  let loadFailed: string[] = [];
  let byWell = new Map<string, Map<string, number>>();
  let usable: Well[] = []; // coordinates + GR curve + at least one top

  beforeAll(() => {
    const files = walk(LAS_DIR);
    for (const f of files) {
      try { allWells.push(parseLasToWell(decodeText(readFileSync(f)), f)); }
      catch (e) { loadFailed.push(`${f}: ${(e as Error).message}`); }
    }

    const tops = parseTopsCsv(readFileSync(join(ROOT, 'tops.csv'), 'utf-8'));
    for (const r of tops.rows) {
      const key = norm(r.well);
      if (!byWell.has(key)) byWell.set(key, new Map());
      byWell.get(key)!.set(r.surface, r.depth);
    }

    const heads = parseWellHeadsCsv(readFileSync(join(ROOT, 'heads.csv'), 'utf-8'));
    const headByName = new Map(heads.rows.map((h) => [norm(h.well), h]));
    for (const w of allWells) {
      const h = headByName.get(norm(w.name));
      if (h) { w.x = h.x; w.y = h.y; w.geodetic = false; }
    }

    usable = allWells.filter(
      (w) => Number.isFinite(w.x) && Number.isFinite(w.y) && pickCurves(w).gr && byWell.has(norm(w.name)),
    );
  }, 180_000);

  it('загружает скважины, разбивки и устья', () => {
    console.log(`LAS: ${allWells.length} прочитано${loadFailed.length ? `, ошибок: ${loadFailed.length}` : ''}`);
    if (loadFailed.length) console.log(loadFailed.slice(0, 5).join('\n'));
    console.log(`разбивок на ${byWell.size} скважин, годных для разноса (координаты + ГК + разбивка) ${usable.length}/${allWells.length}`);

    expect(allWells.length).toBeGreaterThan(50);
    // Only wells that made it into the formations sheet at all have a head
    // coordinate — a well with zero picks contributes neither, so this tracks
    // usable coverage rather than a parsing failure.
    expect(usable.length).toBeGreaterThan(allWells.length * 0.5);
  });

  it('контроль: скважина сама на себя даёт точное попадание', () => {
    let checked = 0;
    for (const w of usable.slice(0, 15)) {
      const fin = w.depth.filter(Number.isFinite);
      if (fin.length < 200) continue;
      const md = fin[Math.floor(fin.length / 2)];
      const p = propagatePick({ well: w, md }, [w])[0];
      expect(p.md).not.toBeNull();
      expect(p.md!).toBeCloseTo(md, 0);
      expect(p.r).toBeGreaterThan(0.999);
      checked++;
    }
    console.log(`самопроверка пройдена на ${checked} скважинах`);
    expect(checked).toBeGreaterThan(3);
  });

  let groups: Cluster[] = [];

  it('находит пространственные кластеры на всём шельфе', () => {
    groups = clusterPoints(usable.map((w) => ({ x: w.x!, y: w.y!, z: 0 })));
    console.log(`\n${usable.length} скважин на шельфе -> ${groups.length} пространственных групп`);
    for (const g of groups.slice(0, 10)) {
      console.log(`  ${String(g.members.length).padStart(3)} скв.  протяжённость ${((g.maxX - g.minX) / 1000).toFixed(1)}×${((g.maxY - g.minY) / 1000).toFixed(1)} км`);
    }
    expect(groups.length).toBeGreaterThan(1); // будь тут одна группа, кластеризация была бы бесполезна
  });

  /**
   * Distance bins, km. The right independent variable here is how far apart
   * two wells actually stand, not which blob the map's gridding-radius
   * clustering happened to chain them into — a first pass filtered pairs by
   * cluster membership and the single "cluster" that survived was 65 wells
   * across 145x142 km, most of the Norwegian shelf: single-linkage chaining
   * had bridged it through a string of ordinary 10-20 km gaps. Every "shared"
   * formation top in that blob was a regional NPD marker (Balder Fm. Top sits
   * on 116 of the 118 wells), so the test was silently asking the correlator
   * to find the same bed 140 km away — nowhere near a fair trial.
   */
  const BINS: [number, number][] = [[0, 5], [5, 15], [15, 30], [30, 60], [60, 120], [120, Infinity]];
  /** Cap references per surface: several NPD tops sit on 100+ wells, and full
   * cross product timed out past 200 s without changing the conclusion. */
  const REF_CAP = 4;

  it('точность разноса против разбивок NPD, по расстоянию между скважинами', () => {
    const span = (w: Well) => {
      const f = w.depth.filter(Number.isFinite);
      return [f[0], f[f.length - 1]] as const;
    };
    const distKm = (a: Well, b: Well) => Math.hypot(a.x! - b.x!, a.y! - b.y!) / 1000;

    const surfaces = new Map<string, Well[]>();
    for (const w of usable) for (const s of byWell.get(norm(w.name))!.keys()) {
      if (!surfaces.has(s)) surfaces.set(s, []);
      surfaces.get(s)!.push(w);
    }

    interface Row { err: number; signed: number; r: number; km: number; well: string; surface: string; ref: string }
    const blind: Row[] = [];
    const hinted: Row[] = [];
    let pairs = 0;

    for (const [surface, ws] of surfaces) {
      if (ws.length < 2) continue;
      // Spread references across the list rather than taking the first N —
      // the sheet is ordered by well/licence, which clusters geographically.
      const refStep = Math.max(1, Math.floor(ws.length / REF_CAP));
      const refs = ws.filter((_, i) => i % refStep === 0).slice(0, REF_CAP);

      for (const refWell of refs) {
        const refMd = byWell.get(norm(refWell.name))!.get(surface)!;
        const [rlo, rhi] = span(refWell);
        if (refMd - DEFAULT_CORRELATION.window < rlo || refMd + DEFAULT_CORRELATION.window > rhi) continue;

        const targets = ws.filter((w) => w !== refWell);
        const blindResult = propagatePick({ well: refWell, md: refMd }, targets);

        // A structural prior: the shift measured on another surface shared by
        // the same pair, the way a geologist ties a section top-down.
        const hint = (target: Well) => {
          const refTops = byWell.get(norm(refWell.name))!;
          const tgtTops = byWell.get(norm(target.name))!;
          const other = [...refTops.keys()].find((s2) => s2 !== surface && tgtTops.has(s2));
          if (!other) return refMd;
          return refMd + (tgtTops.get(other)! - refTops.get(other)!);
        };
        const hintedResult = propagatePick({ well: refWell, md: refMd }, targets, hint);

        for (let i = 0; i < targets.length; i++) {
          const truth = byWell.get(norm(targets[i].name))!.get(surface);
          if (truth == null) continue;
          const [tlo, thi] = span(targets[i]);
          if (truth - DEFAULT_CORRELATION.window < tlo || truth + DEFAULT_CORRELATION.window > thi) continue;

          pairs++;
          const km = distKm(refWell, targets[i]);
          const record = (p: Proposal, sink: Row[]) => {
            if (p.md == null) return;
            sink.push({ err: Math.abs(p.md - truth), signed: p.md - truth, r: p.r, km, well: targets[i].name, surface, ref: refWell.name });
          };
          record(blindResult[i], blind);
          record(hintedResult[i], hinted);
        }
      }
    }
    console.log(`\nвсего пар (эталон×цель, valid coverage): ${pairs}`);

    const byDistance = (rows: Row[]) => {
      console.log('  по расстоянию между скважинами:');
      for (const [lo, hi] of BINS) {
        const bucket = rows.filter((r) => r.km >= lo && r.km < hi);
        if (!bucket.length) continue;
        const be = bucket.map((r) => r.err).sort((a, b) => a - b);
        const ok = bucket.filter((r) => r.err <= 20).length;
        const label = hi === Infinity ? `>${lo} км` : `${lo}–${hi} км`;
        console.log(`    ${label.padStart(9)}: ${String(bucket.length).padStart(4)} шт, медиана ${be[Math.floor(be.length / 2)].toFixed(1)} м, в 20 м: ${ok}/${bucket.length} (${Math.round(100 * ok / bucket.length)}%)`);
      }
    };

    const report = (label: string, rows: Row[]) => {
      if (!rows.length) { console.log(`\n${label}: сравнений нет`); return; }
      const errs = rows.map((r) => r.err).sort((a, b) => a - b);
      const hit20 = rows.filter((r) => r.err <= 20).length;
      const hit50 = rows.filter((r) => r.err <= 50).length;
      const convincing = rows.filter((r) => isConvincing({ md: 0, r: r.r } as Proposal)).length;
      const mean = rows.reduce((a, r) => a + r.signed, 0) / rows.length;
      const sd = Math.sqrt(rows.reduce((a, r) => a + (r.signed - mean) ** 2, 0) / rows.length);

      console.log(`\n${label}: ${rows.length} сравнений`);
      console.log(`  ошибка: медиана ${q(errs, 0.5).toFixed(1)} м, p75 ${q(errs, 0.75).toFixed(1)} м, p90 ${q(errs, 0.9).toFixed(1)} м, макс ${errs[errs.length - 1].toFixed(1)} м`);
      console.log(`  в 20 м: ${hit20}/${rows.length} (${Math.round(100 * hit20 / rows.length)}%) · в 50 м: ${hit50}/${rows.length} (${Math.round(100 * hit50 / rows.length)}%)`);
      console.log(`  знаковая ошибка: среднее ${mean.toFixed(1)} м, разброс ±${sd.toFixed(1)} м (систематический сдвиг, если |среднее| ≫ 0)`);
      console.log(`  убедительных (r ≥ ${DEFAULT_CORRELATION.minR}): ${convincing}/${rows.length}`);
      byDistance(rows);

      console.log('  точность по коэффициенту:');
      for (const [lo, hi] of [[0.9, 1.01], [0.8, 0.9], [0.7, 0.8], [0.6, 0.7], [-1, 0.6]] as const) {
        const bucket = rows.filter((r) => r.r >= lo && r.r < hi);
        if (!bucket.length) continue;
        const be = bucket.map((r) => r.err).sort((a, b) => a - b);
        const ok = bucket.filter((r) => r.err <= 20).length;
        console.log(`    r ${lo < 0 ? '< 0.6' : `${lo}–${hi === 1.01 ? '1.0' : hi}`}: ${String(bucket.length).padStart(4)} шт, медиана ${be[Math.floor(be.length / 2)].toFixed(1)} м, в 20 м: ${ok}/${bucket.length}`);
      }

      const worst = [...rows].sort((a, b) => b.err - a.err).slice(0, 5);
      console.log('  худшие 5:', worst.map((r) => `${r.ref}→${r.well} ${r.surface} Δ${r.err.toFixed(0)}м r=${r.r.toFixed(2)} (${r.km.toFixed(0)}км)`).join(' | '));
    };

    report('БЕЗ подсказки (окно вокруг глубины эталона)', blind);
    report('С ПОДСКАЗКОЙ (сдвиг по соседней привязанной поверхности)', hinted);
  }, 300_000);
});
