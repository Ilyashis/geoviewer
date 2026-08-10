import { useMemo } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { Marker, Well } from '../types';

interface Props {
  wells: Well[];
  markers: Marker[];
  activeWellId: string | null;
  updateMarkerDepth: (markerId: string, wellId: string, depth: number) => void;
  removeMarkerDepth: (markerId: string, wellId: string) => void;
  renameMarker: (markerId: string, label: string) => void;
  removeMarker: (markerId: string) => void;
  addMarkerAtDepth: (wellId: string, depth: number) => void;
}

/** Editable stratigraphy grid: surfaces × wells, with misties and completeness. */
export function WellTie({
  wells, markers, activeWellId, updateMarkerDepth, removeMarkerDepth, renameMarker, removeMarker, addMarkerAtDepth,
}: Props) {
  const midDepth = useMemo(() => {
    let mn = Infinity, mx = -Infinity;
    for (const w of wells) for (const d of w.depth) {
      if (!Number.isFinite(d)) continue;
      if (d < mn) mn = d; if (d > mx) mx = d;
    }
    return Number.isFinite(mn) ? Math.round((mn + mx) / 2) : 2000;
  }, [wells]);
  // The tie table has no per-well click to anchor a real pick on, so the
  // active well stands in as the origin — every other well is then seeded
  // from its nearest neighbour (see addMarkerAtDepth) instead of copying
  // this same number flat across the field.
  const originWellId = activeWellId ?? wells[0]?.id;

  if (wells.length === 0) {
    return (
      <div className="placeholder">
        <div className="pc">
          <h3>Привязка</h3>
          <p>Загрузите скважины — здесь появится таблица разбивок по скважинам.</p>
        </div>
      </div>
    );
  }

  const completeness = wells.map((w) => markers.filter((m) => Number.isFinite(m.depths[w.id])).length);

  return (
    <div className="tie">
      <div className="tie-head">
        <div>
          <div className="tie-eyebrow">Привязка</div>
          <h1 className="tie-title">Стратиграфия по скважинам</h1>
        </div>
        <button className="btn" disabled={!originWellId} onClick={() => originWellId && addMarkerAtDepth(originWellId, midDepth)}>
          <Plus size={15} strokeWidth={1.9} /> Разбивка
        </button>
      </div>

      {markers.length === 0 ? (
        <p className="tie-empty">Разбивок пока нет. Добавьте через кнопку выше или инструментом «Маркер» на корр. схеме.</p>
      ) : (
        <div className="tie-scroll">
          <table className="tie-table">
            <thead>
              <tr>
                <th className="tie-corner">Разбивка</th>
                {wells.map((w) => <th key={w.id} className="tie-well">{w.name}</th>)}
                <th className="tie-spread">Разброс</th>
              </tr>
            </thead>
            <tbody>
              {markers.map((m) => {
                const vals = wells.map((w) => m.depths[w.id]).filter(Number.isFinite) as number[];
                const spread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;
                return (
                  <tr key={m.id}>
                    <td className="tie-surface">
                      <span className="tie-dot" style={{ background: m.color }} />
                      <input className="tie-name" value={m.label}
                        onChange={(e) => renameMarker(m.id, e.target.value)} aria-label="Имя разбивки" />
                      <button className="tie-del" title="Удалить разбивку" onClick={() => removeMarker(m.id)}>
                        <Trash2 size={13} strokeWidth={1.75} />
                      </button>
                    </td>
                    {wells.map((w) => {
                      const d = m.depths[w.id];
                      const has = Number.isFinite(d);
                      return (
                        <td key={w.id}>
                          <input
                            className={`tie-depth ${has ? '' : 'empty'}`}
                            type="number" step={0.1} placeholder="—"
                            value={has ? Number((d as number).toFixed(2)) : ''}
                            onChange={(e) => {
                              const v = e.target.value.trim();
                              if (v === '') removeMarkerDepth(m.id, w.id);
                              else { const n = parseFloat(v); if (Number.isFinite(n)) updateMarkerDepth(m.id, w.id, n); }
                            }}
                          />
                        </td>
                      );
                    })}
                    <td className="tie-spread-val">{spread != null ? `${spread.toFixed(1)}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="tie-foot-label">Пикировок</td>
                {completeness.map((c, i) => (
                  <td key={wells[i].id} className="tie-foot-num">{c}/{markers.length}</td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
