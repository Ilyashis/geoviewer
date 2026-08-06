import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigation } from 'lucide-react';
import type { Well } from '../types';

interface Props {
  wells: Well[];
  activeWellId: string | null;
  onActivate: (id: string) => void;
}

const PAD = 56;

interface Pos { id: string; name: string; x: number; y: number }

/** Plan-view map of wells with the correlation profile line through them. */
export function WellMap({ wells, activeWellId, onActivate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const { positions, schematic } = useMemo(() => {
    const allReal = wells.length > 0 && wells.every((w) => Number.isFinite(w.x) && Number.isFinite(w.y));
    if (allReal) {
      return { positions: wells.map((w) => ({ id: w.id, name: w.name, x: w.x!, y: w.y! })), schematic: false };
    }
    // Schematic transect: spread by index with a small deterministic jitter.
    const pos: Pos[] = wells.map((w, i) => ({ id: w.id, name: w.name, x: i * 100, y: ((i * 53) % 44) - 22 }));
    return { positions: pos, schematic: true };
  }, [wells]);

  const layout = useMemo(() => {
    if (positions.length === 0) return null;
    const xs = positions.map((p) => p.x);
    const ys = positions.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scale = Math.min((size.w - 2 * PAD) / spanX, (size.h - 2 * PAD) / spanY);
    const drawnW = spanX * scale, drawnH = spanY * scale;
    const ox = (size.w - drawnW) / 2;
    const oy = (size.h - drawnH) / 2;
    const toPx = (p: Pos) => ({ px: ox + (p.x - minX) * scale, py: oy + (maxY - p.y) * scale });
    return { pts: positions.map((p) => ({ ...p, ...toPx(p) })) };
  }, [positions, size]);

  if (wells.length === 0) {
    return (
      <div className="placeholder">
        <div className="pc">
          <h3>Карта</h3>
          <p>Загрузите скважины — здесь появится их расположение и профиль корреляции.</p>
        </div>
      </div>
    );
  }

  const pts = layout?.pts ?? [];
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.px.toFixed(1)} ${p.py.toFixed(1)}`).join(' ');

  return (
    <div className="map" ref={wrapRef}>
      <svg className="map-svg" width={size.w} height={size.h}>
        {/* correlation profile line through wells in project order */}
        {pts.length > 1 && (
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeOpacity={0.7}
            strokeDasharray="2 5" strokeLinecap="round" />
        )}
        {pts.map((p) => {
          const active = p.id === activeWellId;
          // Flip label to the left near the right edge so it never clips.
          const flip = p.px > size.w - (p.name.length * 8 + 30);
          return (
            <g key={p.id} className="map-well" onClick={() => onActivate(p.id)}>
              <circle cx={p.px} cy={p.py} r={active ? 9 : 7}
                fill={active ? 'var(--accent)' : 'var(--panel-2)'}
                stroke={active ? '#fff' : 'var(--accent)'} strokeWidth={active ? 2 : 1.5} />
              <text x={p.px + (flip ? -13 : 13)} y={p.py + 4}
                textAnchor={flip ? 'end' : 'start'}
                className={`map-label ${active ? 'on' : ''}`}>{p.name}</text>
            </g>
          );
        })}
      </svg>

      <div className="map-north"><Navigation size={16} strokeWidth={1.9} /> С</div>
      <div className="map-legend">
        <span className="map-leg-line" /> профиль корреляции
      </div>
      {schematic && (
        <div className="map-badge">Условная раскладка — координаты не заданы</div>
      )}
    </div>
  );
}
