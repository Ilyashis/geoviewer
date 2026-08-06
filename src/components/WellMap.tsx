import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigation } from 'lucide-react';
import type { Marker, Well } from '../types';
import { idwGrid, contourLevels } from '../geo/grid';
import { marchingSquares } from '../geo/contours';

interface Props {
  wells: Well[];
  markers: Marker[];
  activeWellId: string | null;
  onActivate: (id: string) => void;
}

const PAD = 64;
type Mode = 'structure' | 'isochore';

interface Pos { id: string; name: string; x: number; y: number }

/** Two-hue ramp, low→high value. */
const RAMP: [number, number, number][] = [
  [214, 69, 69], [232, 145, 58], [232, 207, 58], [91, 184, 91], [58, 163, 201], [58, 107, 201],
];
function rampColor(t: number): string {
  const c = Math.max(0, Math.min(0.999, t)) * (RAMP.length - 1);
  const i = Math.floor(c), f = c - i;
  const a = RAMP[i], b = RAMP[i + 1] ?? RAMP[i];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

interface Field {
  points: { x: number; y: number; z: number }[];
  byWell: Record<string, number>;
  vmin: number;
  vmax: number;
  title: string;
}

/** Plan-view map: wells, profile, and a gridded surface (structure or isochore). */
export function WellMap({ wells, markers, activeWellId, onActivate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [mode, setMode] = useState<Mode>('structure');
  const [surfaceId, setSurfaceId] = useState<string | null>(null);
  const [topId, setTopId] = useState<string | null>(null);
  const [baseId, setBaseId] = useState<string | null>(null);

  const coordWells = useMemo(() => wells.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)), [wells]);
  const schematic = wells.length > 0 && coordWells.length < wells.length;

  const { positions } = useMemo(() => {
    if (!schematic) return { positions: wells.map((w) => ({ id: w.id, name: w.name, x: w.x!, y: w.y! })) };
    const pos: Pos[] = wells.map((w, i) => ({ id: w.id, name: w.name, x: i * 100, y: ((i * 53) % 44) - 22 }));
    return { positions: pos };
  }, [wells, schematic]);

  // Markers mappable as a surface: ≥3 wells with coords and a pick.
  const mappable = useMemo(() => {
    if (schematic) return [];
    const coordIds = new Set(coordWells.map((w) => w.id));
    return markers.filter(
      (m) => Object.keys(m.depths).filter((id) => coordIds.has(id) && Number.isFinite(m.depths[id])).length >= 3
    );
  }, [markers, coordWells, schematic]);

  const surface = mappable.find((m) => m.id === surfaceId) ?? mappable[0] ?? null;
  const top = mappable.find((m) => m.id === topId) ?? mappable[0] ?? null;
  const base = mappable.find((m) => m.id === baseId) ?? mappable.find((m) => m.id !== top?.id) ?? null;

  const field = useMemo<Field | null>(() => {
    const build = (fn: (w: Well) => number | null, title: string): Field | null => {
      const points: Field['points'] = [];
      const byWell: Record<string, number> = {};
      for (const w of coordWells) {
        const z = fn(w);
        if (z == null || !Number.isFinite(z)) continue;
        points.push({ x: w.x!, y: w.y!, z });
        byWell[w.id] = z;
      }
      if (points.length < 3) return null;
      const zs = points.map((p) => p.z);
      return { points, byWell, vmin: Math.min(...zs), vmax: Math.max(...zs), title };
    };

    if (mode === 'structure') {
      if (!surface) return null;
      return build((w) => (Number.isFinite(surface.depths[w.id]) ? surface.depths[w.id] : null), `${surface.label} · глубина, м`);
    }
    if (!top || !base || top.id === base.id) return null;
    return build((w) => {
      const t = top.depths[w.id], b = base.depths[w.id];
      return Number.isFinite(t) && Number.isFinite(b) ? b - t : null;
    }, `${top.label}–${base.label} · толщина, м`);
  }, [mode, surface, top, base, coordWells]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (positions.length === 0) return null;
    const xs = positions.map((p) => p.x), ys = positions.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
    const scale = Math.min((size.w - 2 * PAD) / spanX, (size.h - 2 * PAD) / spanY);
    const ox = (size.w - spanX * scale) / 2, oy = (size.h - spanY * scale) / 2;
    const toPx = (x: number, y: number) => ({ px: ox + (x - minX) * scale, py: oy + (maxY - y) * scale });
    return { minX, maxX, minY, maxY, scale, toPx, pts: positions.map((p) => ({ ...p, ...toPx(p.x, p.y) })) };
  }, [positions, size]);

  // --- Draw the gridded field (fill + contours) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    if (!field) return;

    const padX = (layout.maxX - layout.minX) * 0.12 || 100, padY = (layout.maxY - layout.minY) * 0.12 || 100;
    const minX = layout.minX - padX, maxX = layout.maxX + padX, minY = layout.minY - padY, maxY = layout.maxY + padY;
    const nx = 130, ny = Math.max(20, Math.round(130 * ((maxY - minY) / (maxX - minX))));
    const grid = idwGrid(field.points, minX, maxX, minY, maxY, nx, ny);

    const { vmin, vmax } = field;
    const vt = (v: number) => (vmax > vmin ? (v - vmin) / (vmax - vmin) : 0.5);
    const toPx = layout.toPx;

    ctx.globalAlpha = 0.82;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = minX + i * grid.dx, y = minY + j * grid.dy;
        const p = toPx(x, y), p2 = toPx(x + grid.dx, y - grid.dy);
        ctx.fillStyle = rampColor(vt(grid.z[j * nx + i]));
        ctx.fillRect(p.px - 0.5, p.py - 0.5, p2.px - p.px + 1, p2.py - p.py + 1);
      }
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    for (const level of contourLevels(vmin, vmax, 9)) {
      ctx.beginPath();
      for (const s of marchingSquares(grid, level)) {
        const a = toPx(minX + s.i0 * grid.dx, minY + s.j0 * grid.dy);
        const b = toPx(minX + s.i1 * grid.dx, minY + s.j1 * grid.dy);
        ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
      }
      ctx.stroke();
    }
  }, [field, layout, size]);

  if (wells.length === 0) {
    return (
      <div className="placeholder">
        <div className="pc">
          <h3>Карта</h3>
          <p>Загрузите скважины — здесь появится их расположение, профиль и карты по кровлям (структура, толщины).</p>
        </div>
      </div>
    );
  }

  const pts = layout?.pts ?? [];
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.px.toFixed(1)} ${p.py.toFixed(1)}`).join(' ');

  const SurfBtns = ({ selId, onSel }: { selId: string | undefined; onSel: (id: string) => void }) => (
    <>
      {mappable.map((m) => (
        <button key={m.id} className={`map-surf ${m.id === selId ? 'on' : ''}`} onClick={() => onSel(m.id)}>
          <span className="map-surf-dot" style={{ background: m.color }} />{m.label}
        </button>
      ))}
    </>
  );

  return (
    <div className="map" ref={wrapRef}>
      <canvas ref={canvasRef} className="map-canvas" style={{ width: size.w, height: size.h }} />
      <svg className="map-svg" width={size.w} height={size.h}>
        {pts.length > 1 && (
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeOpacity={0.75}
            strokeDasharray="2 5" strokeLinecap="round" />
        )}
        {pts.map((p) => {
          const active = p.id === activeWellId;
          const flip = p.px > size.w - (p.name.length * 8 + 34);
          const v = field?.byWell[p.id];
          return (
            <g key={p.id} className="map-well" onClick={() => onActivate(p.id)}>
              <circle cx={p.px} cy={p.py} r={active ? 9 : 7}
                fill={active ? 'var(--accent)' : 'var(--panel-2)'}
                stroke={active ? '#fff' : 'var(--accent)'} strokeWidth={active ? 2 : 1.5} />
              <text x={p.px + (flip ? -13 : 13)} y={p.py + 4} textAnchor={flip ? 'end' : 'start'}
                className={`map-label ${active ? 'on' : ''}`}>
                {p.name}{Number.isFinite(v) ? `  ${Math.round(v as number)}` : ''}
              </text>
            </g>
          );
        })}
      </svg>

      {mappable.length > 0 && (
        <div className="map-panel">
          <div className="map-mode">
            <button className={`map-mode-btn ${mode === 'structure' ? 'on' : ''}`} onClick={() => setMode('structure')}>Структура</button>
            <button className={`map-mode-btn ${mode === 'isochore' ? 'on' : ''}`} onClick={() => setMode('isochore')}
              disabled={mappable.length < 2}>Изохора</button>
          </div>
          {mode === 'structure' ? (
            <div className="map-surf-row">
              <span className="map-row-label">Пласт</span>
              <SurfBtns selId={surface?.id} onSel={setSurfaceId} />
            </div>
          ) : (
            <>
              <div className="map-surf-row">
                <span className="map-row-label">Кровля</span>
                <SurfBtns selId={top?.id} onSel={setTopId} />
              </div>
              <div className="map-surf-row">
                <span className="map-row-label">Подошва</span>
                <SurfBtns selId={base?.id} onSel={setBaseId} />
              </div>
            </>
          )}
        </div>
      )}

      <div className="map-north"><Navigation size={16} strokeWidth={1.9} /> С</div>

      <div className="map-legend">
        {field ? (
          <>
            <div className="map-leg-title">{field.title}</div>
            <div className="map-leg-ramp">
              <span className="map-leg-bar" />
              <div className="map-leg-ends"><span>{Math.round(field.vmin)}</span><span>{Math.round(field.vmax)}</span></div>
            </div>
            <div className="map-leg-row"><span className="map-leg-line" /> профиль · изолинии</div>
          </>
        ) : (
          <div className="map-leg-row"><span className="map-leg-line" /> профиль корреляции</div>
        )}
      </div>

      {schematic && <div className="map-badge">Условная раскладка — координаты не заданы</div>}
      {!schematic && mappable.length === 0 && (
        <div className="map-badge">Для карт нужны ≥3 скважины с пикировкой одного пласта</div>
      )}
      {!schematic && mode === 'isochore' && mappable.length >= 2 && !field && (
        <div className="map-badge">Мало общих пикировок для изохоры — выберите два пласта с ≥3 общими скважинами</div>
      )}
    </div>
  );
}
