import { X, Trash2 } from 'lucide-react';
import type { Marker, Well } from '../types';

interface Props {
  marker: Marker;
  wells: Well[];
  onRename: (label: string) => void;
  onDepth: (wellId: string, depth: number) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Right-side inspector for a selected correlation top: per-well depths + misties. */
export function MarkerInspector({ marker, wells, onRename, onDepth, onRemove, onClose }: Props) {
  return (
    <aside className="inspector">
      <div className="insp-head">
        <span className="insp-dot" style={{ background: marker.color }} />
        <input
          className="insp-name"
          value={marker.label}
          onChange={(e) => onRename(e.target.value)}
          aria-label="Имя маркера"
        />
        <button className="insp-x" title="Закрыть" onClick={onClose}><X size={16} strokeWidth={1.75} /></button>
      </div>

      <div className="insp-sub">Глубины и невязки по скважинам</div>

      <div className="insp-rows">
        {wells.map((w, i) => {
          const depth = marker.depths[w.id];
          const prev = i > 0 ? marker.depths[wells[i - 1].id] : undefined;
          const delta = depth != null && prev != null ? depth - prev : null;
          return (
            <div className="insp-row" key={w.id}>
              <div className="insp-well">{w.name}</div>
              <input
                className="insp-depth"
                type="number"
                step={0.1}
                value={depth != null ? Number(depth.toFixed(2)) : ''}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) onDepth(w.id, v);
                }}
              />
              <div className={`insp-delta ${delta == null ? 'muted' : delta >= 0 ? 'pos' : 'neg'}`}>
                {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`}
              </div>
            </div>
          );
        })}
      </div>

      <button className="insp-del" onClick={onRemove}>
        <Trash2 size={15} strokeWidth={1.75} /> Удалить маркер
      </button>
      <div className="insp-keys">Del — удалить · ↑/↓ — глубина (Shift ×10) · Esc — снять</div>
    </aside>
  );
}
