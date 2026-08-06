import { useMemo } from 'react';
import { Layers, Waves, Milestone, Ruler } from 'lucide-react';
import type { Marker, Well } from '../types';

interface Props {
  projectName: string;
  wells: Well[];
  markers: Marker[];
}

function finiteExtent(wells: Well[]): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const w of wells) for (const d of w.depth) {
    if (!Number.isFinite(d)) continue;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return min <= max ? [min, max] : null;
}

/** Project summary: stat tiles, lithology composition, mistie spread, wells. */
export function Dashboard({ projectName, wells, markers }: Props) {
  const stats = useMemo(() => {
    const totalCurves = wells.reduce((s, w) => s + w.curves.length, 0);
    const mnemonics = new Set<string>();
    for (const w of wells) for (const c of w.curves) mnemonics.add(c.mnemonic);
    const extent = finiteExtent(wells);

    // Lithology composition: total thickness per type across all wells.
    const litho = new Map<string, { thickness: number; color: string }>();
    for (const w of wells) for (const iv of w.lithology) {
      const name = iv.litho?.trim() || 'н/д';
      const prev = litho.get(name);
      const t = Math.max(0, iv.base - iv.top);
      if (prev) prev.thickness += t;
      else litho.set(name, { thickness: t, color: iv.color });
    }
    const lithoTotal = [...litho.values()].reduce((s, l) => s + l.thickness, 0);
    const lithoRows = [...litho.entries()]
      .map(([name, l]) => ({ name, ...l, pct: lithoTotal ? (l.thickness / lithoTotal) * 100 : 0 }))
      .sort((a, b) => b.thickness - a.thickness);

    // Mistie spread per surface (marker).
    const mis = markers.map((m) => {
      const ds = Object.values(m.depths).filter(Number.isFinite);
      const min = ds.length ? Math.min(...ds) : null;
      const max = ds.length ? Math.max(...ds) : null;
      return { id: m.id, label: m.label, color: m.color, n: ds.length, min, max,
        spread: min != null && max != null ? max - min : null };
    }).sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1));
    const maxSpread = Math.max(1, ...mis.map((r) => r.spread ?? 0));

    return { totalCurves, uniq: mnemonics.size, extent, lithoRows, lithoTotal, mis, maxSpread };
  }, [wells, markers]);

  if (wells.length === 0) {
    return (
      <div className="placeholder">
        <div className="pc">
          <h3>Дашборд</h3>
          <p>Загрузите скважины — здесь появится сводка по проекту.</p>
        </div>
      </div>
    );
  }

  const { extent } = stats;

  return (
    <div className="dash">
      <div className="dash-head">
        <div className="dash-eyebrow">Проект</div>
        <h1 className="dash-title">{projectName}</h1>
      </div>

      <div className="dash-tiles">
        <Tile icon={<Waves size={18} strokeWidth={1.75} />} label="Скважины" value={String(wells.length)} />
        <Tile icon={<Layers size={18} strokeWidth={1.75} />} label="Кривые" value={String(stats.totalCurves)}
          sub={`${stats.uniq} мнемоник`} />
        <Tile icon={<Milestone size={18} strokeWidth={1.75} />} label="Разбивки" value={String(markers.length)} />
        <Tile icon={<Ruler size={18} strokeWidth={1.75} />} label="Интервал"
          value={extent ? `${Math.round(extent[0])}–${Math.round(extent[1])}` : '—'} sub="м, MD" />
      </div>

      <div className="dash-grid">
        {stats.lithoTotal > 0 && (
          <section className="dash-card">
            <h3 className="dash-card-title">Состав литологии</h3>
            <div className="litho-bar" role="img" aria-label="Доли литотипов по суммарной мощности">
              {stats.lithoRows.map((r) => (
                <span key={r.name} className="litho-seg" title={`${r.name}: ${r.thickness.toFixed(1)} м · ${r.pct.toFixed(1)}%`}
                  style={{ width: `${r.pct}%`, background: r.color }} />
              ))}
            </div>
            <div className="litho-legend">
              {stats.lithoRows.map((r) => (
                <div key={r.name} className="litho-leg-row">
                  <span className="sw" style={{ background: r.color }} />
                  <span className="nm">{r.name}</span>
                  <span className="val">{r.thickness.toFixed(0)} м</span>
                  <span className="pct">{r.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {markers.length > 0 && (
          <section className="dash-card">
            <h3 className="dash-card-title">Невязки по разбивкам</h3>
            <div className="mis-rows">
              {stats.mis.map((r) => (
                <div key={r.id} className="mis-row" title={r.spread != null ? `разброс ${r.spread.toFixed(2)} м` : ''}>
                  <span className="mis-dot" style={{ background: r.color }} />
                  <span className="mis-name">{r.label}</span>
                  <div className="mis-track">
                    <span className="mis-fill" style={{ width: `${((r.spread ?? 0) / stats.maxSpread) * 100}%`, background: r.color }} />
                  </div>
                  <span className="mis-val">{r.spread != null ? `${r.spread.toFixed(1)} м` : '—'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="dash-card dash-wide">
          <h3 className="dash-card-title">Скважины</h3>
          <table className="dash-table">
            <thead>
              <tr><th>Скважина</th><th>Отсчёты</th><th>Кривые</th><th>Интервал, м</th></tr>
            </thead>
            <tbody>
              {wells.map((w) => {
                const e = finiteExtent([w]);
                return (
                  <tr key={w.id}>
                    <td className="mono">{w.name}</td>
                    <td className="num">{w.depth.length}</td>
                    <td className="num">{w.curves.length}</td>
                    <td className="num">{e ? `${Math.round(e[0])}–${Math.round(e[1])}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="dash-tile">
      <div className="dash-tile-top"><span className="dash-tile-ic">{icon}</span>{label}</div>
      <div className="dash-tile-val">{value}</div>
      {sub && <div className="dash-tile-sub">{sub}</div>}
    </div>
  );
}
