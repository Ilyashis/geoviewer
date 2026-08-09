import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Marker, Well } from '../types';
import { basisOf, frameBounds, projectWith, type Basis, type Camera, type Vec3 } from '../core/geom/camera3d';
import { buildSurface, type ControlPoint } from '../core/framework';
import { clusterPoints } from '../core/geom/cluster';
import { tvdss } from '../core/crs';
import { metricWells } from '../wells/coords';
import { computeTrajectory, positionAtMd, tvdAtMd, type TrajPoint } from '../wells/deviation';
import { useStore } from '../store';

interface Props {
  wells: Well[];
  markers: Marker[];
  activeWellId: string | null;
}

/**
 * Grid resolution for display. The map grids at 130 × 145 for contouring
 * accuracy; here every cell is a separately sorted and filled quad, so the
 * mesh is coarser — structural QC reads shape, not the third decimal.
 */
const MESH = 44;
/** Default exaggeration: relief is tens of metres over kilometres of field. */
const DEFAULT_V = 12;

/** One drawable, already projected, carrying the depth it sorts on. */
type Prim =
  | { kind: 'quad'; pts: { x: number; y: number }[]; fill: string; depth: number }
  | { kind: 'line'; pts: { x: number; y: number }[]; stroke: string; width: number; depth: number }
  | { kind: 'text'; x: number; y: number; text: string; fill: string; depth: number };

const RAMP: [number, number, number][] = [
  [214, 69, 69], [232, 145, 58], [232, 207, 58], [91, 184, 91], [58, 163, 201], [58, 107, 201],
];
function rampColor(t: number, alpha: number): string {
  const c = Math.max(0, Math.min(0.999, t)) * (RAMP.length - 1);
  const i = Math.floor(c), f = c - i;
  const a = RAMP[i], b = RAMP[i + 1] ?? RAMP[i];
  return `rgba(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)},${alpha})`;
}

/**
 * 3D view of the structural model: mapped surfaces, well paths and fault
 * planes in one space. Its job is the question a map cannot answer — whether
 * the pieces are consistent with each other. Surfaces that cross, a fault
 * dipping the wrong way, a deviated well that misses the crest: all of them
 * look fine one map at a time.
 *
 * Rendered with the painter's algorithm on Canvas 2D, like every other view
 * here. That is enough for surfaces and wells; a seismic cube would not fit
 * this budget and belongs on WebGL when it arrives.
 */
export function Scene3D({ wells, markers, activeWellId }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [vScale, setVScale] = useState(DEFAULT_V);
  const [showWells, setShowWells] = useState(true);
  const [showFaults, setShowFaults] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]);
  /** Orbit offsets applied on top of the framing camera. */
  const [orbit, setOrbit] = useState({ az: 0, el: 0, zoom: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const faults = useStore((s) => s.faults);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const metric = useMemo(() => metricWells(wells), [wells]);
  const coordWells = useMemo(
    () => metric.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)),
    [metric],
  );

  const trajs = useMemo(() => {
    const m = new Map<string, TrajPoint[]>();
    for (const w of coordWells) if (w.survey?.length) m.set(w.id, computeTrajectory(w.survey));
    return m;
  }, [coordWells]);

  /**
   * Elevation, not depth. `tvdss` is positive downwards — 2600 m below sea
   * level is +2600 — while the camera's z axis points up. Without the flip the
   * whole scene is upside down: deeper surfaces float above the wellheads.
   */
  const elevAt = (w: Well, md: number) => -tvdss(tvdAtMd(trajs.get(w.id) ?? [], md), w.kb);
  const headElev = (w: Well) => -tvdss(0, w.kb);
  const posAt = (w: Well, md: number) => {
    const p = positionAtMd(trajs.get(w.id) ?? [], md);
    return { x: w.x! + p.east, y: w.y! + p.north };
  };

  /** Markers with enough picks to grid, same rule the map uses. */
  const mappable = useMemo(() => {
    const ids = new Set(coordWells.map((w) => w.id));
    return markers.filter(
      (m) => Object.keys(m.depths).filter((id) => ids.has(id) && Number.isFinite(m.depths[id])).length >= 3,
    );
  }, [markers, coordWells]);

  const shown = useMemo(() => mappable.filter((m) => !hidden.includes(m.id)), [mappable, hidden]);

  /** Control points per surface, in TVDSS — the same input the map grids. */
  const controlsFor = useMemo(() => {
    const out = new Map<string, ControlPoint[]>();
    for (const m of mappable) {
      const pts: ControlPoint[] = [];
      for (const w of coordWells) {
        const md = m.depths[w.id];
        if (!Number.isFinite(md)) continue;
        const p = posAt(w, md);
        pts.push({ x: p.x, y: p.y, z: elevAt(w, md) });
      }
      out.set(m.id, pts);
    }
    return out;
  }, [mappable, coordWells, trajs]);

  /**
   * Bounds are taken from the largest cluster of wells, not from all of them.
   * One stray well — a leftover demo point thousands of kilometres away — would
   * otherwise stretch the box until the actual field is a single cell of the
   * 44 x 44 mesh and nothing is visible at all. Outliers still draw; they are
   * just not allowed to decide the framing.
   */
  const framing = useMemo(() => {
    const heads = coordWells.map((w) => ({ x: w.x!, y: w.y!, z: headElev(w) }));
    if (heads.length === 0) return null;
    const groups = clusterPoints(heads);
    const main = new Set(groups[0]?.members ?? heads.map((_, i) => i));
    const inMain = coordWells.filter((_, i) => main.has(i));
    const ids = new Set(inMain.map((w) => w.id));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const eat = (x: number, y: number, z: number) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    };
    for (const w of inMain) {
      eat(w.x!, w.y!, headElev(w));
      // Depth range comes from this cluster's own picks, so an outlier's
      // structure cannot stretch the vertical scale either.
      for (const m of shown) {
        const md = m.depths[w.id];
        if (!Number.isFinite(md)) continue;
        const p = posAt(w, md);
        eat(p.x, p.y, elevAt(w, md));
      }
    }
    if (!Number.isFinite(minX)) return null;
    if (maxZ - minZ < 1) { minZ -= 1; maxZ += 1; }
    return { bounds: { minX, maxX, minY, maxY, minZ, maxZ }, apart: coordWells.length - inMain.length, ids };
  }, [shown, coordWells, trajs]);

  const bounds = framing?.bounds ?? null;

  /** Surfaces gridded on one shared mesh so they stack in the same space. */
  const surfaces = useMemo(() => {
    if (!bounds) return [];
    const pad = Math.max((bounds.maxX - bounds.minX) * 0.06, 50);
    const padY = Math.max((bounds.maxY - bounds.minY) * 0.06, 50);
    const mesh = {
      minX: bounds.minX - pad, maxX: bounds.maxX + pad,
      minY: bounds.minY - padY, maxY: bounds.maxY + padY,
      nx: MESH, ny: MESH,
    };
    const out: { id: string; label: string; color: string; grid: ReturnType<typeof buildSurface> }[] = [];
    for (const m of shown) {
      const built = buildSurface(controlsFor.get(m.id) ?? [], mesh);
      if (built) out.push({ id: m.id, label: m.label, color: m.color, grid: built });
    }
    return out;
  }, [shown, controlsFor, bounds]);

  const camera = useMemo<Camera | null>(() => {
    if (!bounds || size.w < 40 || size.h < 40) return null;
    const base = frameBounds(bounds, size.w, size.h, vScale);
    return {
      ...base,
      azimuth: base.azimuth + orbit.az,
      elevation: Math.max(-1.45, Math.min(1.45, base.elevation + orbit.el)),
      distance: base.distance / orbit.zoom,
    };
  }, [bounds, size, vScale, orbit]);

  // --- Draw ---------------------------------------------------------------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !camera) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const b: Basis = basisOf(camera);
    const P = (p: Vec3) => projectWith(camera, b, p);
    const prims: Prim[] = [];

    for (const s of surfaces) {
      const g = s.grid!.grid;
      const span = (g.zmax - g.zmin) || 1;
      for (let j = 0; j < g.ny - 1; j++) {
        for (let i = 0; i < g.nx - 1; i++) {
          const z00 = g.z[j * g.nx + i], z10 = g.z[j * g.nx + i + 1];
          const z11 = g.z[(j + 1) * g.nx + i + 1], z01 = g.z[(j + 1) * g.nx + i];
          // Blank cells are "no data" — the 3D view must not invent a sheet there.
          if (![z00, z10, z11, z01].every(Number.isFinite)) continue;
          const x0 = g.minX + i * g.dx, x1 = x0 + g.dx;
          const y0 = g.minY + j * g.dy, y1 = y0 + g.dy;
          const c = [P({ x: x0, y: y0, z: z00 }), P({ x: x1, y: y0, z: z10 }),
                     P({ x: x1, y: y1, z: z11 }), P({ x: x0, y: y1, z: z01 })];
          if (!c.every((q) => q.visible)) continue;
          const zm = (z00 + z10 + z11 + z01) / 4;
          prims.push({
            kind: 'quad',
            pts: c.map((q) => ({ x: q.x, y: q.y })),
            // z здесь — отметка; на карте шкала идёт по глубине, поэтому обратно.
            fill: rampColor((g.zmax - zm) / span, 0.9),
            depth: (c[0].depth + c[1].depth + c[2].depth + c[3].depth) / 4,
          });
        }
      }
    }

    if (showFaults) {
      // A fault is drawn as a vertical curtain spanning the model's depth range.
      for (const f of faults) {
        for (let i = 0; i + 1 < f.trace.length; i++) {
          const a = f.trace[i], bb = f.trace[i + 1];
          const c = [P({ x: a.x, y: a.y, z: bounds!.maxZ }), P({ x: bb.x, y: bb.y, z: bounds!.maxZ }),
                     P({ x: bb.x, y: bb.y, z: bounds!.minZ }), P({ x: a.x, y: a.y, z: bounds!.minZ })];
          if (!c.every((q) => q.visible)) continue;
          prims.push({
            kind: 'quad',
            pts: c.map((q) => ({ x: q.x, y: q.y })),
            fill: 'rgba(255,159,10,0.30)',
            depth: (c[0].depth + c[2].depth) / 2,
          });
        }
      }
    }

    if (showWells) {
      for (const w of coordWells) {
        const traj = trajs.get(w.id);
        const active = w.id === activeWellId;
        const head: Vec3 = { x: w.x!, y: w.y!, z: headElev(w) };
        const path: Vec3[] = [head];
        if (traj?.length) {
          for (const t of traj) {
            const p = positionAtMd(traj, t.md);
            path.push({ x: w.x! + p.east, y: w.y! + p.north, z: -tvdss(p.tvd, w.kb) });
          }
        } else {
          path.push({ x: w.x!, y: w.y!, z: bounds!.minZ });
        }
        const proj = path.map(P);
        const vis = proj.filter((q) => q.visible);
        if (vis.length < 2) continue;
        prims.push({
          kind: 'line',
          pts: vis.map((q) => ({ x: q.x, y: q.y })),
          stroke: active ? '#ffffff' : 'rgba(190,205,220,0.85)',
          width: active ? 2.4 : 1.4,
          depth: vis[Math.floor(vis.length / 2)].depth,
        });
        const h = proj[0];
        if (h.visible) {
          prims.push({ kind: 'text', x: h.x + 6, y: h.y - 6, text: w.name,
            fill: active ? '#ffffff' : 'rgba(190,205,220,0.9)', depth: h.depth });
        }
      }
    }

    // Painter's algorithm: far first. Canvas 2D has no depth buffer, so this
    // ordering *is* the occlusion.
    prims.sort((p, q) => q.depth - p.depth);
    for (const p of prims) {
      if (p.kind === 'quad') {
        ctx.beginPath();
        ctx.moveTo(p.pts[0].x, p.pts[0].y);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i].x, p.pts[i].y);
        ctx.closePath();
        ctx.fillStyle = p.fill;
        ctx.fill();
      } else if (p.kind === 'line') {
        ctx.beginPath();
        ctx.moveTo(p.pts[0].x, p.pts[0].y);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i].x, p.pts[i].y);
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.width;
        ctx.stroke();
      } else {
        ctx.fillStyle = p.fill;
        ctx.font = '12px ui-monospace, monospace';
        ctx.fillText(p.text, p.x, p.y);
      }
    }
  }, [camera, surfaces, coordWells, trajs, faults, showWells, showFaults, activeWellId, size, bounds]);

  // --- Interaction --------------------------------------------------------
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setOrbit((o) => ({ ...o, az: o.az - dx * 0.006, el: o.el + dy * 0.006 }));
  };
  const up = () => { dragRef.current = null; };
  const wheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    setOrbit((o) => ({ ...o, zoom: Math.max(0.25, Math.min(6, o.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }));
  };

  const toggle = (id: string) =>
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  return (
    <div className="scene3d" ref={wrapRef}>
      <canvas ref={canvasRef} className="scene3d-canvas" style={{ width: size.w, height: size.h }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} />

      {!bounds && (
        <div className="scene3d-empty">
          Нужны скважины с координатами и хотя бы одна кровля, пропикированная в трёх скважинах.
        </div>
      )}

      {bounds && (
        <div className="scene3d-panel">
          <label className="scene3d-vex">
            <span>Верт. масштаб ×{vScale}</span>
            <input type="range" min={1} max={60} step={1} value={vScale}
              onChange={(e) => setVScale(Number(e.target.value))} />
          </label>
          <div className="scene3d-toggles">
            <button className={`scene3d-btn ${showWells ? 'on' : ''}`} onClick={() => setShowWells((v) => !v)}>Стволы</button>
            <button className={`scene3d-btn ${showFaults ? 'on' : ''}`} onClick={() => setShowFaults((v) => !v)}
              disabled={faults.length === 0}>Разломы{faults.length ? ` (${faults.length})` : ''}</button>
            <button className="scene3d-btn" onClick={() => setOrbit({ az: 0, el: 0, zoom: 1 })}>Сброс вида</button>
          </div>
          {framing && framing.apart > 0 && (
            <div className="scene3d-note">
              {`Кадр по основной группе; ${framing.apart} скв. в стороне и осталась за кадром.`}
            </div>
          )}
          <div className="scene3d-surfs">
            {mappable.map((m) => (
              <button key={m.id} className={`scene3d-surf ${hidden.includes(m.id) ? '' : 'on'}`}
                onClick={() => toggle(m.id)} title={m.label}>
                <span className="map-surf-dot" style={{ background: m.color }} />{m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="scene3d-hint">Перетаскивание — поворот · колесо — приближение</div>
    </div>
  );
}
