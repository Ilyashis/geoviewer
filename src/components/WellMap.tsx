import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Navigation } from 'lucide-react';
import type { Marker, Well } from '../types';
import { contourLevels } from '../core/geom/grid';
import type { Pt } from '../core/geom/polygon';
import { estimateThrow } from '../core/geom/fault';
import { buildSurface, type ControlPoint } from '../core/framework';
import { clusterPoints, clusterGap } from '../core/geom/cluster';
import { SurfacePicker } from './SurfacePicker';
import { tvdss } from '../core/crs';
import { useStore } from '../store';
import { computeTrajectory, positionAtMd, tvdAtMd, type TrajPoint } from '../wells/deviation';
import { metricWells } from '../wells/coords';
import { marchingSquares } from '../core/geom/contours';
import { volumetrics, DEFAULT_VOL_PARAMS, type VolParams, type Contact } from '../reserves/volumetrics';
import { aggregateZone, DEFAULT_PETRO, type PetroParams } from '../wells/petrophysics';
import { monteCarlo, makeTriParams } from '../reserves/uncertainty';
import { buildReservesCsv, renderReservesJpeg, type ReservesInput } from '../export/reserves';
import { jpegToPdf } from '../export/pdf';
import { downloadText, triggerDownload } from '../export/download';
import { FileText, Table } from 'lucide-react';

interface Props {
  wells: Well[];
  markers: Marker[];
  activeWellId: string | null;
  onActivate: (id: string) => void;
}

const PAD = 64;
type Mode = 'structure' | 'isochore';

/** Как получена пористость — показываем, чтобы цифра не была чёрным ящиком. */
const PHI_METHOD_RU: Record<string, string> = {
  density: 'по плотностному каротажу',
  sonic: 'по акустике (Уилли)',
  direct: 'готовая кривая пористости',
  none: 'разными методами по скважинам',
};

interface Pos { id: string; name: string; x: number; y: number }
/** A fault trace and the пласты its plane cuts (usually all of them). */
interface FaultDef { id: string; label: string; markerIds: string[]; trace: Pt[] }

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
  const [vol, setVol] = useState<VolParams>(DEFAULT_VOL_PARAMS);
  const [useLogs, setUseLogs] = useState(false);
  const [petro, setPetro] = useState<PetroParams>(DEFAULT_PETRO);
  const [owcOn, setOwcOn] = useState(false);
  const [owc, setOwc] = useState(0);
  const [pinchOn, setPinchOn] = useState(false);
  const [pinchPts, setPinchPts] = useState<Pt[]>([]);
  const [drawingPinch, setDrawingPinch] = useState(false);
  const pinchDragRef = useRef<number | null>(null);
  const [faults, setFaults] = useState<FaultDef[]>([]);
  const [draftFault, setDraftFault] = useState<Pt[]>([]);
  const [draftFaultMarkerIds, setDraftFaultMarkerIds] = useState<string[]>([]);
  const [drawingFault, setDrawingFault] = useState(false);
  const faultDragRef = useRef<{ faultId: string; idx: number } | null>(null);
  const faultSeqRef = useRef(0);
  const [uncOn, setUncOn] = useState(false);
  const [spread, setSpread] = useState(20);

  // Project any lon/lat wells to metres first — everything below (gridding,
  // areas, volumes, distances) assumes a metric frame.
  const metric = useMemo(() => metricWells(wells), [wells]);
  const coordWells = useMemo(() => metric.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)), [metric]);
  const schematic = wells.length > 0 && coordWells.length < wells.length;

  const { positions } = useMemo(() => {
    if (!schematic) return { positions: metric.map((w) => ({ id: w.id, name: w.name, x: w.x!, y: w.y! })) };
    const pos: Pos[] = metric.map((w, i) => ({ id: w.id, name: w.name, x: i * 100, y: ((i * 53) % 44) - 22 }));
    return { positions: pos };
  }, [metric, schematic]);

  // Markers mappable as a surface: ≥3 wells with coords and a pick.
  const mappable = useMemo(() => {
    if (schematic) return [];
    const coordIds = new Set(coordWells.map((w) => w.id));
    return markers.filter(
      (m) => Object.keys(m.depths).filter((id) => coordIds.has(id) && Number.isFinite(m.depths[id])).length >= 3
    );
  }, [markers, coordWells, schematic]);

  const surfOptions = useMemo(
    () => mappable.map((m) => ({ id: m.id, label: m.label, color: m.color })),
    [mappable],
  );

  const surface = mappable.find((m) => m.id === surfaceId) ?? mappable[0] ?? null;
  const top = mappable.find((m) => m.id === topId) ?? mappable[0] ?? null;
  const base = mappable.find((m) => m.id === baseId) ?? mappable.find((m) => m.id !== top?.id) ?? null;

  // Deviation trajectories (only for wells with a survey); vertical wells fall back to MD.
  const trajs = useMemo(() => {
    const m = new Map<string, TrajPoint[]>();
    for (const w of coordWells) if (w.survey && w.survey.length) m.set(w.id, computeTrajectory(w.survey));
    return m;
  }, [coordWells]);
  const anyDeviated = trajs.size > 0;
  const tvdssAt = (w: Well, md: number) => tvdss(tvdAtMd(trajs.get(w.id) ?? [], md), w.kb);
  const posAt = (w: Well, md: number) => {
    const p = positionAtMd(trajs.get(w.id) ?? [], md);
    return { x: w.x! + p.east, y: w.y! + p.north };
  };

  // Raw structure control points for a marker, independent of the current
  // view/mode — a fault's throw is a property of the horizon it's tied to, so
  // it shouldn't shift just because the user switched tabs.
  const structurePointsFor = (marker: Marker): ControlPoint[] => {
    const points: ControlPoint[] = [];
    for (const w of coordWells) {
      const md = marker.depths[w.id];
      if (!Number.isFinite(md)) continue;
      const pos = posAt(w, md);
      points.push({ x: pos.x, y: pos.y, z: tvdssAt(w, md) });
    }
    return points;
  };

  const seismicHorizons = useStore((s) => s.seismicHorizons);
  // Seismic-derived horizon control points for the selected structure surface,
  // keyed by which line contributed them (a horizon can be picked on more than
  // one seismic line; each keeps its own transect).
  const seismicByLine = useMemo(
    () => (mode === 'structure' && surface ? seismicHorizons[surface.label] : undefined),
    [mode, surface, seismicHorizons],
  );
  const seismicLines = useMemo(() => Object.values(seismicByLine ?? {}).filter((pts) => pts.length > 0), [seismicByLine]);
  const seismicControls = useMemo(() => (seismicLines.length ? seismicLines.flat() : undefined), [seismicLines]);

  const field = useMemo<Field | null>(() => {
    // valueMd → the mapped value plus the MD used to place the (deviated) point.
    // `extra` control points (e.g. a seismic horizon) join the well picks.
    const build = (valueMd: (w: Well) => { value: number; posMd: number } | null, title: string, extra?: ControlPoint[]): Field | null => {
      const points: Field['points'] = [];
      const byWell: Record<string, number> = {};
      for (const w of coordWells) {
        const r = valueMd(w);
        if (!r || !Number.isFinite(r.value)) continue;
        const pos = posAt(w, r.posMd);
        points.push({ x: pos.x, y: pos.y, z: r.value });
        byWell[w.id] = r.value;
      }
      if (extra) for (const c of extra) points.push({ x: c.x, y: c.y, z: c.z });
      if (points.length < 3) return null;
      const zs = points.map((p) => p.z);
      return { points, byWell, vmin: Math.min(...zs), vmax: Math.max(...zs), title };
    };

    if (mode === 'structure') {
      if (!surface) return null;
      return build((w) => {
        const md = surface.depths[w.id];
        return Number.isFinite(md) ? { value: tvdssAt(w, md), posMd: md } : null;
      }, `${surface.label} · TVDSS, м`, seismicControls);
    }
    if (!top || !base || top.id === base.id) return null;
    return build((w) => {
      const t = top.depths[w.id], b = base.depths[w.id];
      if (!Number.isFinite(t) || !Number.isFinite(b)) return null;
      return { value: tvdssAt(w, b) - tvdssAt(w, t), posMd: t }; // true vertical thickness
    }, `${top.label}–${base.label} · толщина TVT, м`);
  }, [mode, surface, top, base, coordWells, trajs, seismicControls]);

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
    const fromPx = (px: number, py: number): Pt => ({ x: minX + (px - ox) / scale, y: maxY - (py - oy) / scale });
    return { minX, maxX, minY, maxY, scale, toPx, fromPx, pts: positions.map((p) => ({ ...p, ...toPx(p.x, p.y) })) };
  }, [positions, size]);

  // Shared mesh (data space, resolution independent of pixel size) so the field
  // grid and any structure grid align cell-for-cell.
  const gridGeom = useMemo(() => {
    if (!layout) return null;
    const padX = (layout.maxX - layout.minX) * 0.12 || 100, padY = (layout.maxY - layout.minY) * 0.12 || 100;
    const minX = layout.minX - padX, maxX = layout.maxX + padX, minY = layout.minY - padY, maxY = layout.maxY + padY;
    const nx = 130, ny = Math.max(20, Math.round(130 * ((maxY - minY) / (maxX - minX))));
    return { minX, maxX, minY, maxY, nx, ny };
  }, [layout]);

  // A fault only blocks interpolation where its tied пласт is actually in play:
  // the selected surface in Структура, either boundary of the zone in Изохора
  // (the interval's rock sits between them, so a break at either end breaks it).
  const activeFaults = useMemo(() => {
    if (mode === 'structure') return surface ? faults.filter((f) => f.markerIds.includes(surface.id)) : [];
    return faults.filter((f) => (top && f.markerIds.includes(top.id)) || (base && f.markerIds.includes(base.id)));
  }, [faults, mode, surface, top, base]);

  // Fault traces block interpolation across them (see buildSurface) — only the
  // faults active for the current surface/zone, structural offsets carrying
  // through to isochore/OWC too since they share this mesh.
  const faultTraces = useMemo(() => activeFaults.map((f) => f.trace), [activeFaults]);

  // The mapped field, built through the structural-framework service: the map
  // consumes a Surface rather than gridding raw picks itself. Well picks are the
  // control-point source today; seismic horizons can feed the same service later.
  const builtSurface = useMemo(
    () => (field && gridGeom ? buildSurface(field.points, gridGeom, faultTraces) : null),
    [field, gridGeom, faultTraces],
  );
  const grid = builtSurface?.grid ?? null;

  /**
   * Wells that don't belong to one field. The grid leaves unreachable cells
   * blank, so a stray well — a leftover demo point, or two fields dropped in
   * together — stretches the mesh over mostly nothing and the map looks broken.
   * Naming the split turns that into a diagnosis.
   */
  const scatterNote = useMemo(() => {
    const pts = field?.points ?? [];
    if (pts.length < 3) return null;
    const cl = clusterPoints(pts);
    if (cl.length < 2) return null;
    const gapKm = Math.min(...cl.slice(1).map((c) => clusterGap(cl[0], c))) / 1000;
    return { groups: cl.length, main: cl[0].members.length, apart: pts.length - cl[0].members.length, gapKm };
  }, [field]);

  // Top-surface structure (TVDSS) on the same mesh — depths for the OWC clip.
  const topGrid = useMemo(() => {
    if (mode !== 'isochore' || !top || !gridGeom) return null;
    const controls: ControlPoint[] = [];
    for (const w of coordWells) {
      const md = top.depths[w.id];
      if (!Number.isFinite(md)) continue;
      const pos = posAt(w, md);
      controls.push({ x: pos.x, y: pos.y, z: tvdssAt(w, md) });
    }
    return buildSurface(controls, gridGeom, faultTraces)?.grid ?? null;
  }, [mode, top, coordWells, gridGeom, trajs, faultTraces]);

  const contact = useMemo<Contact | undefined>(
    () => (owcOn && topGrid && owc > 0 ? { owc, top: topGrid } : undefined),
    [owcOn, topGrid, owc],
  );

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
    if (!grid || !field) return;

    const { vmin, vmax } = field;
    const vt = (v: number) => (vmax > vmin ? (v - vmin) / (vmax - vmin) : 0.5);
    const toPx = layout.toPx;
    const { nx, ny, dx, dy, minX, minY } = grid;

    ctx.globalAlpha = 0.82;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v = grid.z[j * nx + i];
        if (!Number.isFinite(v)) continue; // вне досягаемости данных — не закрашиваем
        const x = minX + i * dx, y = minY + j * dy;
        const p = toPx(x, y), p2 = toPx(x + dx, y - dy);
        ctx.fillStyle = rampColor(vt(v));
        ctx.fillRect(p.px - 0.5, p.py - 0.5, p2.px - p.px + 1, p2.py - p.py + 1);
      }
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    for (const level of contourLevels(vmin, vmax, 9)) {
      ctx.beginPath();
      for (const s of marchingSquares(grid, level)) {
        const a = toPx(minX + s.i0 * dx, minY + s.j0 * dy);
        const b = toPx(minX + s.i1 * dx, minY + s.j1 * dy);
        ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
      }
      ctx.stroke();
    }

    // OWC: flood the water leg (top deeper than the contact) and draw the contact line.
    if (contact && contact.top.z.length === grid.z.length) {
      const tg = contact.top;
      ctx.fillStyle = 'rgba(18, 42, 74, 0.5)';
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (grid.z[j * nx + i] > 0 && tg.z[j * nx + i] >= contact.owc) {
            const x = minX + i * dx, y = minY + j * dy;
            const p = toPx(x, y), p2 = toPx(x + dx, y - dy);
            ctx.fillRect(p.px - 0.5, p.py - 0.5, p2.px - p.px + 1, p2.py - p.py + 1);
          }
        }
      }
      ctx.strokeStyle = 'rgba(96, 194, 255, 0.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const s of marchingSquares(tg, contact.owc)) {
        const a = toPx(minX + s.i0 * dx, minY + s.j0 * dy);
        const b = toPx(minX + s.i1 * dx, minY + s.j1 * dy);
        ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
      }
      ctx.stroke();
    }
  }, [grid, field, layout, size, contact]);

  // Log-derived net-pay stats for the isochore zone [top, base] across the mapped wells.
  const logStats = useMemo(() => {
    if (mode !== 'isochore' || !top || !base || top.id === base.id) return null;
    return aggregateZone(coordWells, (w) => top.depths[w.id], (w) => base.depths[w.id], petro);
  }, [mode, top, base, coordWells, petro]);

  const effVol = useMemo<VolParams>(
    () => (useLogs && logStats ? { ...vol, ng: logStats.ng, phi: logStats.phi, sw: logStats.sw } : vol),
    [useLogs, logStats, vol],
  );

  // Suggested contact: partway down the top-surface depth range, so a closure exists.
  const owcDefault = useMemo(() => {
    if (mode !== 'isochore' || !top) return 0;
    const zs = coordWells
      .filter((w) => Number.isFinite(top.depths[w.id]))
      .map((w) => tvdssAt(w, top.depths[w.id])); // OWC is a TVDSS depth
    if (zs.length < 3) return 0;
    const lo = Math.min(...zs), hi = Math.max(...zs);
    return Math.round(lo + 0.55 * (hi - lo));
  }, [mode, top, coordWells, trajs]);

  useEffect(() => {
    if (owcOn && owc === 0 && owcDefault > 0) setOwc(owcDefault);
  }, [owcOn, owc, owcDefault]);

  // Pinch-out boundary: only a closed (≥3-vertex) polygon clips the volume.
  const pinchClip = useMemo<Pt[] | undefined>(
    () => (pinchOn && pinchPts.length >= 3 ? pinchPts : undefined),
    [pinchOn, pinchPts],
  );

  // Throw is per (fault, пласт): one plane cutting several horizons offsets each
  // by its own amount — that's real, throw varies along a fault plane. Each is
  // measured against that пласт's own structure, so a given pair's number never
  // changes with what's on screen. Faults already shape `grid` itself
  // (buildSurface got faultTraces for the active ones); this is reporting.
  const faultThrows = useMemo(() => {
    const m: Record<string, Record<string, number | null>> = {};
    for (const f of faults) {
      m[f.id] = {};
      for (const id of f.markerIds) {
        const marker = mappable.find((mk) => mk.id === id);
        m[f.id][id] = marker ? estimateThrow(f.trace, structurePointsFor(marker)) : null;
      }
    }
    return m;
  }, [faults, mappable, coordWells, trajs]);

  // The пласт whose structure is being gridded — the one a displayed throw refers to.
  const viewMarker = mode === 'structure' ? surface : top;
  const throwAtView = (f: FaultDef): number | null =>
    (viewMarker ? faultThrows[f.id]?.[viewMarker.id] : null) ?? null;

  // Only faults active for the current surface/zone count toward the reserves
  // report — a fault that doesn't cut this пласт didn't touch this volume.
  const faultSummary = useMemo(() => {
    if (activeFaults.length === 0) return null;
    const throws = activeFaults.map(throwAtView).filter((t): t is number => t != null).map(Math.abs);
    return { count: activeFaults.length, maxThrow: throws.length ? Math.max(...throws) : null };
  }, [activeFaults, faultThrows, viewMarker]);

  const volResult = useMemo(
    () => (mode === 'isochore' && grid ? volumetrics(grid, effVol, contact, pinchClip) : null),
    [mode, grid, effVol, contact, pinchClip],
  );

  // Probabilistic reserves: Monte-Carlo the recovery chain around the deterministic modes.
  const mc = useMemo(() => {
    if (!uncOn || !volResult || volResult.grossM3 <= 0) return null;
    return monteCarlo(volResult.grossM3, makeTriParams(effVol, spread / 100));
  }, [uncOn, volResult, effVol, spread]);

  const reservesInput = (): ReservesInput | null => {
    if (!volResult || !field) return null;
    return {
      zone: field.title.split(' ·')[0],
      source: useLogs && logStats ? 'logs' : 'manual',
      wellCount: coordWells.length,
      logWells: logStats?.wellsUsed,
      params: effVol,
      owc: contact ? owc : null,
      pinchoutVertices: pinchClip ? pinchClip.length : null,
      faultCount: faultSummary?.count ?? null,
      faultMaxThrow: faultSummary?.maxThrow ?? null,
      det: volResult,
      mc,
      spreadPct: uncOn ? spread : undefined,
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
  };
  const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const exportReservesCsv = () => {
    const r = reservesInput();
    if (r) downloadText(`reserves-${fileStamp()}.csv`, buildReservesCsv(r));
  };
  const exportReservesPdf = () => {
    const r = reservesInput();
    if (!r) return;
    const img = renderReservesJpeg(r);
    triggerDownload(`reserves-${fileStamp()}.pdf`, URL.createObjectURL(jpegToPdf(img.dataUrl, img.width, img.height)), true);
  };

  // --- Pinch-out polygon: click-to-place vertices, then drag any of them ---
  // Checking the box keeps an already-drawn polygon (like the ВНК depth persists
  // when its checkbox is toggled) — only an empty polygon prompts a fresh draw.
  const togglePinchOn = (checked: boolean) => {
    setPinchOn(checked);
    const startDrawing = checked && pinchPts.length < 3;
    setDrawingPinch(startDrawing);
    if (startDrawing) { setDrawingFault(false); setDraftFault([]); } // only one draw session at a time
  };
  const redrawPinch = () => { setDrawingPinch(true); setPinchPts([]); setDrawingFault(false); setDraftFault([]); };
  const finishPinchDraw = () => setDrawingPinch(false);
  const cancelPinchDraw = () => { setDrawingPinch(false); setPinchOn(false); setPinchPts([]); };

  // --- Faults: an open trace (≥2 vertices) per fault, same click/drag pattern ---
  // A fault plane normally cuts the whole section, so it defaults to every пласт;
  // the pills shown while drawing let you deselect the ones it doesn't reach
  // (a fault dying out upward, or one that only offsets the lower horizons).
  const startFaultDraw = () => {
    setDrawingFault(true);
    setDraftFault([]);
    setDrawingPinch(false);
    setDraftFaultMarkerIds(mappable.map((m) => m.id));
  };
  const toggleDraftMarker = (id: string) =>
    setDraftFaultMarkerIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const finishFaultDraw = () => {
    if (draftFault.length < 2 || draftFaultMarkerIds.length === 0) return;
    faultSeqRef.current += 1;
    setFaults((fs) => [...fs, {
      id: `fault-${faultSeqRef.current}`,
      label: `Разлом ${faultSeqRef.current}`,
      markerIds: mappable.filter((m) => draftFaultMarkerIds.includes(m.id)).map((m) => m.id), // keep пласт order
      trace: draftFault,
    }]);
    setDrawingFault(false);
    setDraftFault([]);
  };
  const cancelFaultDraw = () => { setDrawingFault(false); setDraftFault([]); setDraftFaultMarkerIds([]); };
  const removeFault = (id: string) => setFaults((fs) => fs.filter((f) => f.id !== id));

  const svgDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!layout) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pt = layout.fromPx(e.clientX - rect.left, e.clientY - rect.top);
    if (drawingPinch) { setPinchPts((pts) => [...pts, pt]); return; }
    if (drawingFault) { setDraftFault((pts) => [...pts, pt]); return; }
  };
  const vertexDown = (i: number) => (e: ReactPointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    pinchDragRef.current = i;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const faultVertexDown = (faultId: string, idx: number) => (e: ReactPointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    faultDragRef.current = { faultId, idx };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const svgMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!layout) return;
    if (pinchDragRef.current == null && faultDragRef.current == null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pt = layout.fromPx(e.clientX - rect.left, e.clientY - rect.top);
    if (pinchDragRef.current != null) {
      const idx = pinchDragRef.current;
      setPinchPts((pts) => pts.map((p, k) => (k === idx ? pt : p)));
    } else if (faultDragRef.current != null) {
      const { faultId, idx } = faultDragRef.current;
      setFaults((fs) => fs.map((f) => (f.id === faultId ? { ...f, trace: f.trace.map((p, k) => (k === idx ? pt : p)) } : f)));
    }
  };
  const svgUp = () => { pinchDragRef.current = null; faultDragRef.current = null; };

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

  // Plan-view deviation: wellhead → bottom-hole drift at the deepest mapped pick.
  const devVectors = layout
    ? coordWells.flatMap((w) => {
        const tr = trajs.get(w.id);
        if (!tr) return [];
        let maxMd = -Infinity;
        for (const m of mappable) { const d = m.depths[w.id]; if (Number.isFinite(d) && d > maxMd) maxMd = d; }
        if (!Number.isFinite(maxMd)) return [];
        const dp = positionAtMd(tr, maxMd);
        const s = layout.toPx(w.x!, w.y!), e = layout.toPx(w.x! + dp.east, w.y! + dp.north);
        return [{ id: w.id, sx: s.px, sy: s.py, ex: e.px, ey: e.py }];
      })
    : [];

  // The seismic horizon transects that feed the current structure surface — one
  // path per contributing line, so picks on different lines don't zigzag together.
  const seismicPaths = layout
    ? seismicLines.map((pts) => pts.map((c, i) => { const p = layout.toPx(c.x, c.y); return `${i === 0 ? 'M' : 'L'} ${p.px.toFixed(1)} ${p.py.toFixed(1)}`; }).join(' '))
    : [];

  const pinchScreenPts = layout ? pinchPts.map((p) => layout.toPx(p.x, p.y)) : [];
  const pinchClosed = pinchOn && pinchPts.length >= 3;
  const pinchOutline = pinchScreenPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.px.toFixed(1)} ${p.py.toFixed(1)}`).join(' ') + (pinchClosed ? ' Z' : '');

  const toPath = (pts: { px: number; py: number }[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.px.toFixed(1)} ${p.py.toFixed(1)}`).join(' ');
  const faultScreenTraces = layout
    ? faults.map((f) => ({ id: f.id, pts: f.trace.map((p) => layout.toPx(p.x, p.y)), active: activeFaults.some((af) => af.id === f.id) }))
    : [];
  const draftFaultScreenPts = layout ? draftFault.map((p) => layout.toPx(p.x, p.y)) : [];


  return (
    <div className="map" ref={wrapRef}>
      <canvas ref={canvasRef} className="map-canvas" style={{ width: size.w, height: size.h }} />
      <svg className="map-svg" width={size.w} height={size.h}
        style={{ cursor: drawingPinch || drawingFault ? 'crosshair' : undefined }}
        onPointerDown={svgDown} onPointerMove={svgMove} onPointerUp={svgUp}>
        {pinchOn && pinchScreenPts.length > 0 && (
          <g className="map-pinch">
            {pinchClosed && (
              <path
                d={`M0 0H${size.w}V${size.h}H0Z ${pinchOutline}`}
                fillRule="evenodd" className="map-pinch-mask" />
            )}
            <path d={pinchOutline} fill="none" className="map-pinch-line" />
            {pinchScreenPts.map((p, i) => (
              <circle key={i} cx={p.px} cy={p.py} r={6} className="map-pinch-vertex" onPointerDown={vertexDown(i)} />
            ))}
          </g>
        )}
        {faultScreenTraces.map(({ id, pts, active }) => (
          <g key={id} className={`map-fault ${active ? '' : 'inactive'}`}>
            <path d={toPath(pts)} fill="none" className="map-fault-line" />
            {pts.map((p, i) => (
              <circle key={i} cx={p.px} cy={p.py} r={6} className="map-fault-vertex" onPointerDown={faultVertexDown(id, i)} />
            ))}
          </g>
        ))}
        {drawingFault && draftFaultScreenPts.length > 0 && (
          <path d={toPath(draftFaultScreenPts)} fill="none" className="map-fault-line draft" />
        )}
        {pts.length > 1 && (
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeOpacity={0.75}
            strokeDasharray="2 5" strokeLinecap="round" />
        )}
        {devVectors.map((d) => (
          <g key={`dev-${d.id}`} className="map-dev">
            <line x1={d.sx} y1={d.sy} x2={d.ex} y2={d.ey} />
            <circle cx={d.ex} cy={d.ey} r={3} />
          </g>
        ))}
        {seismicPaths.map((d, i) => (
          <path key={`seis-${i}`} d={d} fill="none" stroke="var(--accent-2)" strokeWidth={2.5}
            strokeOpacity={0.92} strokeLinecap="round" strokeLinejoin="round" />
        ))}
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
            <SurfacePicker label="Пласт" options={surfOptions} value={surface?.id} onChange={setSurfaceId} />
          ) : (
            <>
              <SurfacePicker label="Кровля" options={surfOptions} value={top?.id} onChange={setTopId} />
              <SurfacePicker label="Подошва" options={surfOptions} value={base?.id} onChange={setBaseId} />
            </>
          )}
        </div>
      )}

      {mappable.length > 0 && (
        <div className="map-fault-panel">
          <div className="map-fault-head">
            <span>Разломы</span>
            <button className="map-fault-add" disabled={drawingFault} onClick={startFaultDraw}>+ разлом</button>
          </div>
          {drawingFault && (
            <div className="map-fault-marker-pick">
              <div className="map-fault-pick-h">
                <span>Сечёт пласты</span>
                <button className="map-fault-all"
                  onClick={() => setDraftFaultMarkerIds(draftFaultMarkerIds.length === mappable.length ? [] : mappable.map((m) => m.id))}>
                  {draftFaultMarkerIds.length === mappable.length ? 'снять все' : 'все'}
                </button>
              </div>
              <div className="map-surf-row">
                {mappable.map((m) => (
                  <button key={m.id} className={`map-surf ${draftFaultMarkerIds.includes(m.id) ? 'on' : ''}`}
                    onClick={() => toggleDraftMarker(m.id)}>
                    <span className="map-surf-dot" style={{ background: m.color }} />{m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {faults.length === 0 ? (
            <div className="map-fault-empty">Нет разломов</div>
          ) : (
            faults.map((f) => {
              const t = throwAtView(f);
              const cut = mappable.filter((m) => f.markerIds.includes(m.id));
              const isActive = activeFaults.some((af) => af.id === f.id);
              const cutLabel = cut.length === mappable.length ? 'все' : cut.map((m) => m.label).join(', ');
              // Per-пласт throws, so the numbers behind a single displayed value stay inspectable.
              const perMarker = cut
                .map((m) => `${m.label}: ${faultThrows[f.id]?.[m.id] == null ? '—' : `${Math.round(Math.abs(faultThrows[f.id][m.id]!))} м`}`)
                .join('\n');
              return (
                <div key={f.id} className={`map-fault-row ${isActive ? '' : 'inactive'}`}
                  title={`${f.label} · сечёт: ${cutLabel}\n${perMarker}${isActive ? '' : '\n\n(не влияет на текущий вид)'}`}>
                  <span className="map-fault-dot" />
                  <span className="map-fault-label">{f.label} · {cutLabel}</span>
                  <span className="map-fault-throw">{t == null ? '—' : `${Math.round(Math.abs(t))} м`}</span>
                  <button className="map-fault-del" title="Удалить разлом" onClick={() => removeFault(f.id)}>×</button>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className={`map-north ${volResult && field ? 'aside' : ''}`}><Navigation size={16} strokeWidth={1.9} /> С</div>

      {(drawingPinch || drawingFault) && (
        <div className="map-draw-hint">
          <span>{drawingPinch
            ? 'Кликайте по карте, чтобы поставить точки контура выклинивания'
            : 'Кликайте по карте, чтобы поставить точки трассы разлома'}</span>
          <b>{(drawingPinch ? pinchPts.length : draftFault.length)} точ.</b>
          <button className="map-draw-btn on" disabled={drawingPinch ? pinchPts.length < 3 : (draftFault.length < 2 || draftFaultMarkerIds.length === 0)}
            onClick={drawingPinch ? finishPinchDraw : finishFaultDraw}>Готово</button>
          <button className="map-draw-btn" onClick={drawingPinch ? cancelPinchDraw : cancelFaultDraw}>Отмена</button>
        </div>
      )}

      <div className="map-legend">
        {field ? (
          <>
            <div className="map-leg-title">{field.title}</div>
            <div className="map-leg-ramp">
              <span className="map-leg-bar" />
              <div className="map-leg-ends"><span>{Math.round(field.vmin)}</span><span>{Math.round(field.vmax)}</span></div>
            </div>
            <div className="map-leg-row"><span className="map-leg-line" /> профиль · изолинии</div>
            {contact && <div className="map-leg-row"><span className="map-leg-owc" /> ВНК {Math.round(owc)} м</div>}
            {pinchClip && <div className="map-leg-row"><span className="map-leg-pinch" /> выклинивание ({pinchClip.length} верш.)</div>}
            {activeFaults.length > 0 && <div className="map-leg-row"><span className="map-leg-fault" /> разлом{activeFaults.length > 1 ? 'ов' : ''} ({activeFaults.length})</div>}
            {anyDeviated && <div className="map-leg-row"><span className="map-leg-dev" /> накл. ствол → снос/TVDSS</div>}
            {scatterNote && (
              <div className="map-leg-warn">
                {`Скважины в ${scatterNote.groups} группах: ${scatterNote.apart} в стороне от основных ${scatterNote.main}, ` +
                 `просвет ${scatterNote.gapKm < 10 ? scatterNote.gapKm.toFixed(1) : Math.round(scatterNote.gapKm)} км. ` +
                 'Между группами карта пуста — там нет данных.'}
              </div>
            )}
            {seismicControls && seismicControls.length > 0 && (
              <div className="map-leg-row"><span className="map-leg-seis" /> сейсмо-горизонт ({seismicControls.length} тчк{seismicLines.length > 1 ? `, ${seismicLines.length} лин.` : ''})</div>
            )}
          </>
        ) : (
          <div className="map-leg-row"><span className="map-leg-line" /> профиль корреляции</div>
        )}
      </div>

      {volResult && field && (
        <aside className="vol-panel">
          <div className="vol-head">Подсчёт запасов · {field.title.split(' ·')[0]}</div>
          <div className="vol-src">
            <button className={`vol-src-btn ${!useLogs ? 'on' : ''}`} onClick={() => setUseLogs(false)}>Ручные</button>
            <button className={`vol-src-btn ${useLogs ? 'on' : ''}`} onClick={() => setUseLogs(true)}>Из логов</button>
          </div>
          {useLogs && logStats ? (
            <>
              <div className="vol-derived">
                <VolRow k="N/G · нетто/брутто" v={logStats.ng.toFixed(2)} strong />
                <VolRow k="φ · пористость (нетто)" v={logStats.phi.toFixed(3)} />
                <VolRow k="Sw · водонасыщ. (нетто)" v={logStats.sw.toFixed(2)} />
                <VolRow k="Скважин в зоне" v={String(logStats.wellsUsed)} />
              </div>
              <div className="vol-note">
                {`φ — ${PHI_METHOD_RU[logStats.phiMethod]}`}
                {/* Отсечки ниже не управляют скважинами, где коллектор задан
                    интерпретатором, — об этом честнее сказать прямо. */}
                {logStats.interpreted > 0
                  ? ` · коллектор по К_кол у ${logStats.interpreted} из ${logStats.wellsUsed} скв. (отсечки к ним не применяются)`
                  : ''}
                {logStats.curves ? ` · кривые: ${logStats.curves}` : ''}
              </div>
              <div className="vol-params cols3">
                <VolInput label="Vsh отс." value={petro.vshCut} step={0.05} onChange={(v) => setPetro({ ...petro, vshCut: v })} />
                <VolInput label="φ отс." value={petro.phiCut} step={0.01} onChange={(v) => setPetro({ ...petro, phiCut: v })} />
                <VolInput label="Sw отс." value={petro.swCut} step={0.05} onChange={(v) => setPetro({ ...petro, swCut: v })} />
                <VolInput label="Rw" value={petro.rw} step={0.01} onChange={(v) => setPetro({ ...petro, rw: v })} />
                <VolInput label="Bo" value={vol.bo} step={0.05} onChange={(v) => setVol({ ...vol, bo: v })} />
                <VolInput label="ККИН" value={vol.rf} step={0.05} onChange={(v) => setVol({ ...vol, rf: v })} />
              </div>
            </>
          ) : (
            <>
              {useLogs && (
                <div className="vol-note">Нет кривых GR/RHOB/RES в интервале — используются ручные параметры.</div>
              )}
              <div className="vol-params">
                <VolInput label="N/G" value={vol.ng} step={0.05} onChange={(v) => setVol({ ...vol, ng: v })} />
                <VolInput label="φ" value={vol.phi} step={0.05} onChange={(v) => setVol({ ...vol, phi: v })} />
                <VolInput label="Sw" value={vol.sw} step={0.05} onChange={(v) => setVol({ ...vol, sw: v })} />
                <VolInput label="Bo" value={vol.bo} step={0.05} onChange={(v) => setVol({ ...vol, bo: v })} />
                <VolInput label="ККИН" value={vol.rf} step={0.05} onChange={(v) => setVol({ ...vol, rf: v })} />
              </div>
            </>
          )}
          <div className="vol-owc">
            <label className="vol-owc-tog">
              <input type="checkbox" checked={owcOn} onChange={(e) => setOwcOn(e.target.checked)} />
              <span>Контакт ВНК</span>
            </label>
            {owcOn && (
              <label className="vol-owc-depth">
                <input type="number" step={1} value={owc}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setOwc(v); }} />
                <span>м</span>
              </label>
            )}
          </div>
          {owcOn && !topGrid && <div className="vol-note">Нет структуры кровли — контакт не применён.</div>}
          <div className="vol-owc">
            <label className="vol-owc-tog">
              <input type="checkbox" checked={pinchOn} onChange={(e) => togglePinchOn(e.target.checked)} />
              <span>Полигон выклинивания</span>
            </label>
            {pinchOn && !drawingPinch && (
              <button className="vol-pinch-redraw" onClick={redrawPinch}>перерисовать</button>
            )}
          </div>
          {pinchOn && !drawingPinch && pinchPts.length < 3 && (
            <div className="vol-note">Нужно ≥3 точки контура — нажмите «перерисовать».</div>
          )}
          <div className="vol-results">
            <VolRow k={contact ? 'Площадь в ВНК' : 'Площадь'} v={`${volResult.areaKm2.toFixed(2)} км²`} />
            <VolRow k={contact ? 'Ср. HC-толщина' : 'Ср. толщина'} v={`${volResult.meanThickness.toFixed(1)} м`} />
            <VolRow k={contact ? 'HC объём (GRV)' : 'Объём породы (GRV)'} v={fmtM(volResult.grossM3, 'м³')} />
            <VolRow k="УВ поровый (HCPV)" v={fmtM(volResult.hcpvM3, 'м³')} />
            <VolRow k="STOOIP" v={fmtM(volResult.stooipM3, 'м³')} strong />
            <VolRow k="STOOIP" v={fmtM(volResult.stooipBbl, 'барр')} />
            <VolRow k="Извлекаемые" v={fmtM(volResult.recoverableBbl, 'барр')} strong />
          </div>
          <div className="vol-note">
            {(() => {
              const clips: string[] = [];
              if (contact) clips.push(`только порода выше ВНК ${Math.round(owc)} м`);
              if (pinchClip) clips.push(`в пределах контура выклинивания (${pinchClip.length} верш.)`);
              if (faultSummary) clips.push(`гриддинг с учётом ${faultSummary.count} разл.${faultSummary.maxThrow != null ? ` (макс. сброс ~${Math.round(faultSummary.maxThrow)} м)` : ''}`);
              return clips.length
                ? `${clips.join(' · ')} · замыкание не учитывается.`
                : 'Интеграл по всей площади карты · без учёта контакта.';
            })()}
          </div>
          <div className="vol-owc vol-unc-tog">
            <label className="vol-owc-tog">
              <input type="checkbox" checked={uncOn} onChange={(e) => setUncOn(e.target.checked)} />
              <span>Неопределённость</span>
            </label>
            {uncOn && (
              <label className="vol-owc-depth">
                <input type="number" step={5} min={0} max={80} value={spread}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setSpread(Math.max(0, v)); }} />
                <span>±%</span>
              </label>
            )}
          </div>
          {mc && (
            <>
              <div className="vol-unc-grid">
                <span />
                <span className="vol-unc-h">P90</span><span className="vol-unc-h">P50</span><span className="vol-unc-h">P10</span>
                <span className="vol-unc-lbl">STOOIP</span>
                <span>{mbbl(mc.stooip.p90)}</span><b>{mbbl(mc.stooip.p50)}</b><span>{mbbl(mc.stooip.p10)}</span>
                <span className="vol-unc-lbl">Извлек.</span>
                <span>{mbbl(mc.recoverable.p90)}</span><b>{mbbl(mc.recoverable.p50)}</b><span>{mbbl(mc.recoverable.p10)}</span>
              </div>
              <div className="vol-note">{mc.samples} реализаций · треуг. ±{spread}% · млн барр</div>
            </>
          )}
          <div className="vol-export">
            <button className="vol-exp-btn" onClick={exportReservesCsv} title="Отчёт о запасах в CSV">
              <Table size={13} strokeWidth={1.9} /> CSV
            </button>
            <button className="vol-exp-btn" onClick={exportReservesPdf} title="Отчёт о запасах в PDF">
              <FileText size={13} strokeWidth={1.9} /> PDF
            </button>
          </div>
        </aside>
      )}

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

function fmtM(x: number, unit: string): string {
  const a = Math.abs(x);
  if (a >= 1e6) return `${(x / 1e6).toFixed(2)} млн ${unit}`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(1)} тыс ${unit}`;
  return `${Math.round(x)} ${unit}`;
}

/** Barrels → millions, 2 decimals (grid cells share the "млн барр" caption). */
function mbbl(x: number): string {
  return (x / 1e6).toFixed(2);
}

function VolInput({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="vol-in">
      <span>{label}</span>
      <input type="number" step={step} min={0} value={value}
        onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}

function VolRow({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`vol-row ${strong ? 'strong' : ''}`}>
      <span className="vol-k">{k}</span>
      <span className="vol-v">{v}</span>
    </div>
  );
}
