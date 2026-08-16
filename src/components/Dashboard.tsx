import { useMemo, useState } from 'react';
import { Layers, Waves, Milestone, Ruler, ArrowRight } from 'lucide-react';
import type { Marker, Well } from '../types';
import { useStore } from '../store';

interface Props {
  projectName: string;
  wells: Well[];
  markers: Marker[];
  onActivateWell: (id: string) => void;
  onSelectMarker: (id: string) => void;
  /** Switches the active tab; `focus` additionally asks that view to select
   * one specific item once it's open (`focusRequest` in the framework slice). */
  onShow: (tab: string, focus?: { target: 'seismicLine' | 'section'; id: string }) => void;
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

type DataKind = 'wells' | 'markers' | 'checkshots' | 'segy' | 'faults' | 'sections' | 'horizons';

/** Project summary: stat tiles, lithology composition, mistie spread, and
 * every other object type in the project — one table, switched by tab,
 * replacing the standalone "Данные проекта" sidebar (same idea: a read-only
 * index of everything loaded/created, with "Показать" jumping to the view
 * that actually owns that object, rather than a second place to edit it). */
export function Dashboard({ projectName, wells, markers, onActivateWell, onSelectMarker, onShow }: Props) {
  const checkshots = useStore((s) => s.checkshots);
  const segyLines = useStore((s) => s.segyLines);
  const faults = useStore((s) => s.faults);
  const sections = useStore((s) => s.sections);
  const seismicHorizons = useStore((s) => s.seismicHorizons);
  const [kind, setKind] = useState<DataKind>('wells');

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

  const horizonRows = useMemo(() => Object.entries(seismicHorizons).flatMap(([label, byLine]) =>
    Object.keys(byLine).map((lineId) => ({ label, lineId }))), [seismicHorizons]);

  const dataTabs: { key: DataKind; label: string; count: number }[] = [
    { key: 'wells', label: 'Скважины', count: wells.length },
    { key: 'markers', label: 'Разбивки', count: markers.length },
    { key: 'checkshots', label: 'Чекшоты', count: checkshots.length },
    { key: 'segy', label: 'SEG-Y', count: segyLines.length },
    { key: 'faults', label: 'Разломы', count: faults.length },
    { key: 'sections', label: 'Разрезы', count: sections.length },
    { key: 'horizons', label: 'Сейсмогоризонты', count: horizonRows.length },
  ];

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
          <h3 className="dash-card-title">Данные проекта</h3>
          <div className="dash-tabs">
            {dataTabs.map((t) => (
              <button key={t.key} className={`dash-tab-btn ${kind === t.key ? 'on' : ''}`} onClick={() => setKind(t.key)}>
                {t.label} {t.count}
              </button>
            ))}
          </div>

          {kind === 'wells' && (
            wells.length === 0 ? <div className="dash-table-empty">нет</div> : (
              <table className="dash-table">
                <thead><tr><th>Скважина</th><th>Отсчёты</th><th>Кривые</th><th>Интервал, м</th><th /></tr></thead>
                <tbody>
                  {wells.map((w) => {
                    const e = finiteExtent([w]);
                    return (
                      <tr key={w.id}>
                        <td className="mono">{w.name}</td>
                        <td className="num">{w.depth.length}</td>
                        <td className="num">{w.curves.length}</td>
                        <td className="num">{e ? `${Math.round(e[0])}–${Math.round(e[1])}` : '—'}</td>
                        <td><ShowBtn onClick={() => { onActivateWell(w.id); onShow('correlation'); }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}

          {kind === 'markers' && (
            markers.length === 0 ? <div className="dash-table-empty">нет</div> : (
              <table className="dash-table">
                <thead><tr><th>Разбивка</th><th>Пикетов</th><th>Затравлено</th><th /></tr></thead>
                <tbody>
                  {markers.map((m) => {
                    const n = Object.values(m.depths).filter(Number.isFinite).length;
                    const seeded = m.seeded?.length ?? 0;
                    return (
                      <tr key={m.id}>
                        <td className="mono"><span className="dash-dot" style={{ background: m.color }} />{m.label}</td>
                        <td className="num">{n}</td>
                        <td className="num">{seeded || '—'}</td>
                        <td><ShowBtn onClick={() => { onSelectMarker(m.id); onShow('correlation'); }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}

          {kind === 'checkshots' && (
            checkshots.length === 0 ? <div className="dash-table-empty">нет</div> : (
              <table className="dash-table">
                <thead><tr><th>Скважина</th><th>Пар</th><th /></tr></thead>
                <tbody>
                  {checkshots.map((c) => (
                    <tr key={c.well}>
                      <td className="mono">{c.well}</td>
                      <td className="num">{c.points.length}</td>
                      <td><ShowBtn onClick={() => onShow('seismic')} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {kind === 'segy' && (
            segyLines.length === 0 ? <div className="dash-table-empty">нет</div> : (
              <table className="dash-table">
                <thead><tr><th>Линия</th><th>Трасс</th><th>Привязка</th><th /></tr></thead>
                <tbody>
                  {segyLines.map((l) => (
                    <tr key={l.id}>
                      <td className="mono">{l.label}</td>
                      <td className="num">{l.traceCount}</td>
                      <td className={l.tie ? '' : 'warn'}>{l.tie ? 'привязана' : 'не привязана'}</td>
                      <td><ShowBtn onClick={() => onShow('seismic', { target: 'seismicLine', id: l.id })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {kind === 'faults' && (
            faults.length === 0 ? <div className="dash-table-empty">нет</div> : (
              <table className="dash-table">
                <thead><tr><th>Разлом</th><th>Пласты</th><th>Падение</th><th /></tr></thead>
                <tbody>
                  {faults.map((f) => (
                    <tr key={f.id}>
                      <td className="mono">{f.label}</td>
                      <td className="num">{f.markerIds.length}</td>
                      <td className="num">{f.dip != null ? `${f.dip}°` : '—'}</td>
                      <td><ShowBtn onClick={() => onShow('map')} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {kind === 'sections' && (
            sections.length === 0 ? <div className="dash-table-empty">нет</div> : (
              <table className="dash-table">
                <thead><tr><th>Линия</th><th>Точек</th><th /></tr></thead>
                <tbody>
                  {sections.map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{s.label}</td>
                      <td className="num">{s.points.length}</td>
                      <td><ShowBtn onClick={() => onShow('section', { target: 'section', id: s.id })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {kind === 'horizons' && (
            horizonRows.length === 0 ? <div className="dash-table-empty">нет</div> : (
              <table className="dash-table">
                <thead><tr><th>Пласт</th><th>Линия</th><th /></tr></thead>
                <tbody>
                  {horizonRows.map((h) => (
                    <tr key={`${h.label}-${h.lineId}`}>
                      <td className="mono">{h.label}</td>
                      <td>{h.lineId}</td>
                      <td><ShowBtn onClick={() => onShow('seismic', { target: 'seismicLine', id: h.lineId })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
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

function ShowBtn({ onClick }: { onClick: () => void }) {
  return <button className="dash-show" title="Показать" onClick={onClick}><ArrowRight size={13} strokeWidth={1.75} /></button>;
}
