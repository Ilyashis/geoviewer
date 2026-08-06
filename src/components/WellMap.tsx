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

interface Pos { id: string; name: string; x: number; y: number }

/** Shallow→deep structural colour ramp (red high → blue low). */
const RAMP: [number, number, number][] = [
  [214, 69, 69], [232, 145, 58], [232, 207, 58], [91, 184, 91], [58, 163, 201], [58, 107, 201],
];
function rampColor(t: number): string {
  const c = Math.max(0, Math.min(0.999, t)) * (RAMP.length - 1);
  const i = Math.floor(c);
  const f = c - i;
  const a = RAMP[i], b = RAMP[i + 1] ?? RAMP[i];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

/** Plan-view map: wells, correlation profile, and a structural surface from tops. */
export function WellMap({ wells, markers, activeWellId, onActivate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const { positions, schematic } = useMemo(() => {
    const allReal = wells.length > 0 && wells.every((w) => Number.isFinite(w.x) && Number.isFinite(w.y));
    if (allReal) return { positions: wells.map((w) => ({ id: w.id, name: w.name, x: w.x!, y: w.y! })), schematic: false };
    const pos: Pos[] = wells.map((w, i) => ({ id: w.id, name: w.name, x: i * 100, y: ((i * 53) % 44) - 22 }));
    return { positions: pos, schematic: true };
  }, [wells]);

  // Surfaces mappable from tops: real coords + ≥3 wells picked.
  const surfaces = useMemo(() => {
    if (schematic) return [];
    const coord = new Set(wells.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)).map((w) => w.id));
    return markers
      .map((m) => ({ m, n: Object.keys(m.depths).filter((id) => coord.has(id) && Number.isFinite(m.depths[id])).length }))
      .filter((s) => s.n >= 3)
      .map((s) => s.m);
  }, [markers, wells, schematic]);

  const [surfaceId, setSurfaceId] = useState<string | null>(null);
  const surface = surfaces.find((m) => m.id === surfaceId) ?? surfaces[0] ?? null;

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
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
    const scale = Math.min((size.w - 2 * PAD) / spanX, (size.h - 2 * PAD) / spanY);
    const ox = (size.w - spanX * scale) / 2, oy = (size.h - spanY * scale) / 2;
    const toPx = (x: number, y: number) => ({ px: ox + (x - minX) * scale, py: oy + (maxY - y) * scale });
    return { minX, maxX, minY, maxY, scale, toPx, pts: positions.map((p) => ({ ...p, ...toPx(p.x, p.y) })) };
  }, [positions, size]);

  // --- Draw the structural surface (fill + contours) on the canvas ---
  const zrange = useMemo<[number, number] | null>(() => {
    if (!surface) return null;
    const zs = wells.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y))
      .map((w) => surface.depths[w.id]).filter(Number.isFinite) as number[];
    return zs.length >= 3 ? [Math.min(...zs), Math.max(...zs)] : null;
  }, [surface, wells]);

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
    if (!surface || !zrange) return;

    const pts = wells
      .filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(surface.depths[w.id]))
      .map((w) => ({ x: w.x!, y: w.y!, z: surface.depths[w.id] }));
    if (pts.length < 3) return;

    // Grid over the wells' bbox, padded ~12%.
    const gx0 = layout.minX, gx1 = layout.maxX, gy0 = layout.minY, gy1 = layout.maxY;
    const padX = (gx1 - gx0) * 0.12 || 100, padY = (gy1 - gy0) * 0.12 || 100;
    const minX = gx0 - padX, maxX = gx1 + padX, minY = gy0 - padY, maxY = gy1 + padY;
    const nx = 130, ny = Math.max(20, Math.round(130 * ((maxY - minY) / (maxX - minX))));
    const grid = idwGrid(pts, minX, maxX, minY, maxY, nx, ny);

    const [zmin, zmax] = zrange;
    const zt = (z: number) => (zmax > zmin ? (z - zmin) / (zmax - zmin) : 0.5);
    const dataToPx = layout.toPx;

    // Filled cells.
    ctx.globalAlpha = 0.82;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = minX + i * grid.dx, y = minY + j * grid.dy;
        const p = dataToPx(x, y);
        const p2 = dataToPx(x + grid.dx, y - grid.dy);
        ctx.fillStyle = rampColor(zt(grid.z[j * nx + i]));
        ctx.fillRect(p.px - 0.5, p.py - 0.5, p2.px - p.px + 1, p2.py - p.py + 1);
      }
    }
    ctx.globalAlpha = 1;

    // Contour iso-lines at nice depth levels.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    for (const level of contourLevels(zmin, zmax, 9)) {
      ctx.beginPath();
      for (const s of marchingSquares(grid, level)) {
        const a = dataToPx(minX + s.i0 * grid.dx, minY + s.j0 * grid.dy);
        const b = dataToPx(minX + s.i1 * grid.dx, minY + s.j1 * grid.dy);
        ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
      }
      ctx.stroke();
    }
  }, [surface, zrange, layout, size, wells]);

  if (wells.length === 0) {
    return (
      <div className="placeholder">
        <div className="pc">
          <h3>Карта</h3>
          <p>Загрузите скважины — здесь появится их расположение, профиль и структурная карта по кровлям.</p>
        </div>
      </div>
    );
  }

  const pts = layout?.pts ?? [];
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.px.toFixed(1)} ${p.py.toFixed(1)}`).join(' ');

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
          const flip = p.px > size.w - (p.name.length * 8 + 30);
          const depth = surface?.depths[p.id];
          return (
            <g key={p.id} className="map-well" onClick={() => onActivate(p.id)}>
              <circle cx={p.px} cy={p.py} r={active ? 9 : 7}
                fill={active ? 'var(--accent)' : 'var(--panel-2)'}
                stroke={active ? '#fff' : 'var(--accent)'} strokeWidth={active ? 2 : 1.5} />
              <text x={p.px + (flip ? -13 : 13)} y={p.py + 4} textAnchor={flip ? 'end' : 'start'}
                className={`map-label ${active ? 'on' : ''}`}>
                {p.name}{Number.isFinite(depth) ? `  ${Math.round(depth as number)}` : ''}
              </text>
            </g>
          );
        })}
      </svg>

      {surfaces.length > 0 && (
        <div className="map-surfaces">
          <span className="map-surfaces-label">Поверхность</span>
          {surfaces.map((m) => (
            <button key={m.id} className={`map-surf ${m.id === surface?.id ? 'on' : ''}`}
              onClick={() => setSurfaceId(m.id)}>
              <span className="map-surf-dot" style={{ background: m.color }} />{m.label}
            </button>
          ))}
        </div>
      )}

      <div className="map-north"><Navigation size={16} strokeWidth={1.9} /> С</div>

      <div className="map-legend">
        {surface && zrange ? (
          <>
            <div className="map-leg-title">{surface.label} · глубина, м</div>
            <div className="map-leg-ramp">
              <span className="map-leg-bar" />
              <div className="map-leg-ends"><span>{Math.round(zrange[0])}</span><span>{Math.round(zrange[1])}</span></div>
            </div>
            <div className="map-leg-row"><span className="map-leg-line" /> профиль · изогипсы</div>
          </>
        ) : (
          <div className="map-leg-row"><span className="map-leg-line" /> профиль корреляции</div>
        )}
      </div>

      {schematic && <div className="map-badge">Условная раскладка — координаты не заданы</div>}
      {!schematic && surfaces.length === 0 && (
        <div className="map-badge">Для структурной карты нужны ≥3 скважины с пикировкой одного пласта</div>
      )}
    </div>
  );
}
