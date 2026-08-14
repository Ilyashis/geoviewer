import { useEffect, useMemo, useRef, useState } from 'react';
import type { Marker, Well } from '../types';
import { dataRadius, niceStep, sampleGrid, type ControlPoint } from '../core/geom/grid';
import { projectOntoPolyline, sampleAlongPolyline } from '../core/geom/line';
import { buildSurface, type Mesh } from '../core/framework';
import { tvdss } from '../core/crs';
import { useStore } from '../store';
import { metricWells } from '../wells/coords';
import { computeTrajectory, positionAtMd, tvdAtMd, type TrajPoint } from '../wells/deviation';
import { SurfacePicker } from './SurfacePicker';

interface Props {
  wells: Well[];
  markers: Marker[];
  activeWellId: string | null;
}

const MESH_N = 130;
/** Metres between samples along the line — fine enough that a fault gap or a
 * blank-grid edge shows as a real step, not a smoothed diagonal. */
const SAMPLE_STEP = 25;

/**
 * Vertical cross-section along a line drawn on the map (`WellMap`'s "+ разрез"
 * tool, stored in `sections` so it survives switching tabs — the wells-are-
 * evenly-spaced correlation schema and this share nothing but the idea).
 *
 * Two things this view gets right that a straight ruler across the map
 * wouldn't: wells sit at their true along-line distance, not an arbitrary
 * plate width — a section spanning 40 km and one spanning 400 m both plot
 * correctly. And every surface trace comes from `buildSurface`'s IDW grid,
 * the same one the map contours, sampled continuously along the line — not
 * straight segments between the wells that happen to be near it. A gap in
 * well control shows as a real gap in the trace, exactly like the map leaves
 * a cell blank rather than inventing structure over it (`core/geom/grid`).
 */
export function CrossSectionView({ wells, markers, activeWellId }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const sections = useStore((s) => s.sections);
  const faults = useStore((s) => s.faults);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);

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
  const tvdssAt = (w: Well, md: number) => tvdss(tvdAtMd(trajs.get(w.id) ?? [], md), w.kb);
  const posAt = (w: Well, md: number) => {
    const p = positionAtMd(trajs.get(w.id) ?? [], md);
    return { x: w.x! + p.east, y: w.y! + p.north };
  };

  const mappable = useMemo(() => {
    const ids = new Set(coordWells.map((w) => w.id));
    return markers.filter(
      (m) => Object.keys(m.depths).filter((id) => ids.has(id) && Number.isFinite(m.depths[id])).length >= 3,
    );
  }, [markers, coordWells]);
  const shown = useMemo(() => mappable.filter((m) => !hidden.includes(m.id)), [mappable, hidden]);

  const section = sections.find((s) => s.id === sectionId) ?? sections[0] ?? null;

  /**
   * Wells within reach of the line. The corridor is the same "typical
   * spacing" measure the map uses to stop IDW inventing structure across real
   * gaps (`dataRadius`) — a well further off than that isn't part of this
   * field's local control either way, so it has no business appearing on a
   * section through it.
   */
  const onLine = useMemo(() => {
    if (!section || section.points.length < 2 || coordWells.length === 0) return [];
    const corridor = dataRadius(coordWells.map((w) => ({ x: w.x!, y: w.y!, z: 0 })));
    const withProj = coordWells.map((w) => ({ well: w, ...projectOntoPolyline({ x: w.x!, y: w.y! }, section.points) }));
    return withProj.filter((p) => p.perp <= corridor).sort((a, b) => a.arc - b.arc);
  }, [section, coordWells]);

  const lineLength = section ? section.points.reduce(
    (len, p, i) => (i === 0 ? 0 : len + Math.hypot(p.x - section.points[i - 1].x, p.y - section.points[i - 1].y)), 0,
  ) : 0;

  /** Structural control points for a marker across every coordinate-bearing
   * well in the project — deliberately not just the ones near the line, so
   * the interpolation the section samples is the same honest field-wide one
   * the map builds, not a thinner one starved of control by the line's path. */
  const controlsFor = (marker: Marker): ControlPoint[] => {
    const pts: ControlPoint[] = [];
    for (const w of coordWells) {
      const md = marker.depths[w.id];
      if (!Number.isFinite(md)) continue;
      const pos = posAt(w, md);
      pts.push({ x: pos.x, y: pos.y, z: tvdssAt(w, md) });
    }
    return pts;
  };

  const mesh = useMemo<Mesh | null>(() => {
    if (coordWells.length === 0) return null;
    const xs = coordWells.map((w) => w.x!), ys = coordWells.map((w) => w.y!);
    const minXr = Math.min(...xs), maxXr = Math.max(...xs), minYr = Math.min(...ys), maxYr = Math.max(...ys);
    const padX = (maxXr - minXr) * 0.12 || 100, padY = (maxYr - minYr) * 0.12 || 100;
    const minX = minXr - padX, maxX = maxXr + padX, minY = minYr - padY, maxY = maxYr + padY;
    return { minX, maxX, minY, maxY, nx: MESH_N, ny: Math.max(20, Math.round(MESH_N * ((maxY - minY) / (maxX - minX)))) };
  }, [coordWells]);

  /** One continuous, arc-sampled trace per shown marker; NaN runs (out of IDW
   * reach, or across a fault this marker doesn't cross) become gaps, drawn as
   * a broken line rather than bridged. */
  const traces = useMemo(() => {
    if (!section || section.points.length < 2 || !mesh) return [];
    const path = sampleAlongPolyline(section.points, SAMPLE_STEP);
    return shown.map((m) => {
      const cut = faults.filter((f) => f.markerIds.includes(m.id)).map((f) => f.trace);
      const grid = buildSurface(controlsFor(m), mesh, cut)?.grid ?? null;
      const vals = grid ? path.map((p) => ({ arc: p.arc, z: sampleGrid(grid, p.x, p.y) })) : [];
      return { marker: m, vals };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, mesh, shown, faults, coordWells, trajs]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !section) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const text = v('--text', '#f4f7fa'), text2 = v('--text-2', '#a7b4c4'), text3 = v('--text-3', '#636e83');
    const border = v('--border', 'rgba(151,178,196,0.16)'), hairline = v('--hairline', 'rgba(151,178,196,0.08)');
    ctx.font = '11px ui-monospace, monospace';

    const L = 64, R = 20, T = 20, B = 34;
    const pw = Math.max(10, size.w - L - R), ph = Math.max(10, size.h - T - B);
    if (pw < 30 || ph < 30 || lineLength <= 0) return;

    // Vertical extent: every well's logged range, every pick, every sampled trace.
    let zMin = Infinity, zMax = -Infinity;
    for (const { well } of onLine) {
      const fin = well.depth.filter(Number.isFinite);
      if (!fin.length) continue;
      const top = tvdssAt(well, fin[0]), base = tvdssAt(well, fin[fin.length - 1]);
      zMin = Math.min(zMin, top, base); zMax = Math.max(zMax, top, base);
    }
    for (const { vals } of traces) for (const p of vals) if (Number.isFinite(p.z)) { zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); }
    for (const m of shown) for (const { well } of onLine) {
      const md = m.depths[well.id];
      if (Number.isFinite(md)) { const z = tvdssAt(well, md); zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); }
    }
    if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) return;
    const pad = Math.max((zMax - zMin) * 0.08, 5);
    zMin -= pad; zMax += pad;

    const xOf = (arc: number) => L + (arc / lineLength) * pw;
    const yOf = (z: number) => T + ((z - zMin) / (zMax - zMin)) * ph;

    // Depth axis (TVDSS, м).
    ctx.textAlign = 'right';
    const zStep = niceStep((zMax - zMin) / 7);
    for (let z = Math.ceil(zMin / zStep) * zStep; z <= zMax; z += zStep) {
      const y = yOf(z);
      ctx.strokeStyle = hairline; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = text3; ctx.fillText(String(Math.round(z)), L - 8, y + 4);
    }
    // Distance axis (м), along the bottom.
    ctx.textAlign = 'center';
    const xStep = niceStep(lineLength / 6);
    for (let a = 0; a <= lineLength + 1e-6; a += xStep) {
      const x = xOf(a);
      ctx.strokeStyle = hairline; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      ctx.fillStyle = text3; ctx.fillText(`${Math.round(a)} м`, x, T + ph + 16);
    }
    ctx.strokeStyle = border; ctx.strokeRect(L, T, pw, ph);

    // Structural traces: continuous, broken at NaN (no IDW reach / faulted out).
    for (const { marker, vals } of traces) {
      ctx.strokeStyle = marker.color; ctx.lineWidth = 2; ctx.beginPath();
      let open = false;
      for (const p of vals) {
        if (!Number.isFinite(p.z)) { open = false; continue; }
        const x = xOf(p.arc), y = yOf(p.z);
        if (!open) { ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Wells: a stick spanning their logged range, lithology if they have it,
    // then each shown marker's actual pick as a dot on top of the trace.
    for (const { well, arc } of onLine) {
      const active = well.id === activeWellId;
      const x = xOf(arc);
      const fin = well.depth.filter(Number.isFinite);
      if (fin.length) {
        const yTop = yOf(tvdssAt(well, fin[0])), yBase = yOf(tvdssAt(well, fin[fin.length - 1]));
        ctx.strokeStyle = active ? text : text2; ctx.lineWidth = active ? 2.5 : 1.5;
        ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBase); ctx.stroke();

        for (const iv of well.lithology) {
          const y0 = yOf(tvdssAt(well, iv.top)), y1 = yOf(tvdssAt(well, iv.base));
          ctx.fillStyle = iv.color; ctx.fillRect(x - 3, Math.min(y0, y1), 6, Math.max(1, Math.abs(y1 - y0)));
        }
      }
      ctx.fillStyle = active ? text : text2;
      ctx.textAlign = 'center';
      ctx.font = `${active ? 'bold ' : ''}11px ui-monospace, monospace`;
      ctx.fillText(well.name, x, T - 6);
      ctx.font = '11px ui-monospace, monospace';

      for (const m of shown) {
        const md = m.depths[well.id];
        if (!Number.isFinite(md)) continue;
        const y = yOf(tvdssAt(well, md));
        const seeded = m.seeded?.includes(well.id);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = seeded ? v('--panel', '#1b2127') : m.color;
        ctx.fill();
        ctx.strokeStyle = seeded ? m.color : v('--panel', '#1b2127');
        ctx.lineWidth = seeded ? 2 : 1.5;
        ctx.stroke();
      }
    }
  };

  useEffect(draw);

  if (sections.length === 0) {
    return (
      <div className="placeholder">
        <div className="pc">
          <h3>Разрез</h3>
          <p>Нарисуйте линию разреза на карте — инструмент «+ разрез» рядом с разломами.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="section" ref={wrapRef}>
      <canvas ref={canvasRef} className="section-canvas" style={{ width: size.w, height: size.h }} />

      <div className="section-panel">
        <SurfacePicker
          label="Линия"
          options={sections.map((s) => ({ id: s.id, label: s.label }))}
          value={section?.id}
          onChange={setSectionId}
        />
        {onLine.length === 0 ? (
          <div className="section-empty">Ни одна скважина не попала в коридор вдоль линии.</div>
        ) : (
          <div className="section-note">{onLine.length} скв. на линии, длина {Math.round(lineLength)} м</div>
        )}
        {mappable.length > 0 && (
          <div className="scene3d-surfs">
            {mappable.map((m) => (
              <button key={m.id} className={`scene3d-surf ${hidden.includes(m.id) ? '' : 'on'}`}
                onClick={() => setHidden((h) => (h.includes(m.id) ? h.filter((x) => x !== m.id) : [...h, m.id]))}
                title={m.label}>
                <span className="map-surf-dot" style={{ background: m.color }} />{m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
