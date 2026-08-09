import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Marker, Well } from '../types';
import {
  buildFieldSection, autoTrackHorizon, horizonControls,
  sampleNodes, interpolateHorizon, tieToWells, sampleHorizonAt, EARTH,
  type HorizonNode, type FieldSection,
} from '../seismic';
import { SurfacePicker } from './SurfacePicker';
import { buildSurface } from '../core/framework';
import { metricWells } from '../wells/coords';
import { segmentIntersection } from '../core/geom/intersect';
import {
  twtToDepth, velocityAt, calibrateVelocity, DEFAULT_VELOCITY, COMPACTION,
  type VelocityModel, type VelocitySample,
} from '../core/velocity';
import { fieldVelocityTable } from '../wells/checkshot';
import { useStore } from '../store';

interface Props {
  wells: Well[];
  markers: Marker[];
}

type LineId = string;
interface EditState { label: string; color: string; nodes: HorizonNode[] }

const LINES: { id: LineId; label: string; axis: 'x' | 'y' }[] = [
  { id: 'A', label: 'W → E', axis: 'x' },
  { id: 'B', label: 'S → N', axis: 'y' },
];

type ConvKey = 'const' | 'linear' | 'cal' | 'checkshot';
const NODE_COUNT = 14; // editable nodes along the horizon
// Depth-conversion presets; 'cal' is fitted from the well ties on demand.
const CONV_PRESETS: Record<'const' | 'linear', VelocityModel> = { const: DEFAULT_VELOCITY, linear: COMPACTION };
const niceStep = (raw: number) => { const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Dark variable-density seismic: near-black at zero, red for +, cyan-blue for −. */
function seismicColor(v: number): [number, number, number] {
  const a = Math.min(1, Math.abs(v));
  return v >= 0 ? [30 + 225 * a, 34 + 36 * a, 34] : [30, 44 + 120 * a, 44 + 211 * a];
}

/**
 * 2D seismic: two independent lines (W→E and S→N) through the same wells, each
 * with its own editable horizon pick. Where the lines physically cross, a picked
 * horizon common to both can be checked for mistie — the loop-tie QC step real
 * interpretation uses to catch a bad pick before it reaches the structure map.
 */
export function SeismicView({ wells, markers }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<number | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [lineId, setLineId] = useState<LineId>('A');
  const [edits, setEdits] = useState<Record<LineId, EditState | null>>({});
  const [convKey, setConvKey] = useState<ConvKey>('const');
  const [calModel, setCalModel] = useState<VelocityModel | null>(null);
  /** Numbering for picks seeded by clicking an imported line. */
  const [pickSeq, setPickSeq] = useState(1);
  const checkshots = useStore((s) => s.checkshots);
  const segyLines = useStore((s) => s.segyLines);
  const seismicHorizons = useStore((s) => s.seismicHorizons);
  const setSeismicHorizon = useStore((s) => s.setSeismicHorizon);
  const clearSeismicHorizon = useStore((s) => s.clearSeismicHorizon);

  const edit = edits[lineId];
  const setEdit = (e: EditState | null) => setEdits((prev) => ({ ...prev, [lineId]: e }));

  // The conversion velocity applied to picked times (independent of the earth truth
  // the section was built with). Switching it re-converts live — it does NOT rebuild
  // the section, so the picked horizon survives.
  // Measured time–depth from the wells — the only non-guessed velocity available.
  const checkshotModel = useMemo<VelocityModel | null>(() => {
    if (checkshots.length === 0) return null;
    const pairs = fieldVelocityTable(checkshots);
    if (pairs.length < 2) return null;
    return { kind: 'table', pairs, label: `чекшоты, ${checkshots.length} скв.` };
  }, [checkshots]);

  const conv = useMemo<VelocityModel>(
    () => {
      if (convKey === 'cal' && calModel) return calModel;
      if (convKey === 'checkshot' && checkshotModel) return checkshotModel;
      return CONV_PRESETS[convKey === 'cal' || convKey === 'checkshot' ? 'const' : convKey];
    },
    [convKey, calModel, checkshotModel],
  );
  // Project lon/lat wells to metres — line geometry and depth conversion below
  // are metric.
  const coordWells = useMemo(
    () => metricWells(wells).filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)),
    [wells],
  );
  // Both lines are built together (geometry is cheap) so they can be tied at their
  // crossing point regardless of which one is on screen; only the active line's
  // raster gets rendered.
  const fieldA = useMemo(() => buildFieldSection(coordWells, markers, 'x'), [coordWells, markers]);
  const fieldB = useMemo(() => buildFieldSection(coordWells, markers, 'y'), [coordWells, markers]);
  const fields = useMemo<Record<LineId, FieldSection | null>>(() => {
    const m: Record<LineId, FieldSection | null> = { A: fieldA, B: fieldB };
    // An imported line becomes a FieldSection with no wells posted: its
    // coordinates are in the survey's own CRS, which need not match the
    // project's, so nothing here may be tied to the map.
    for (const l of segyLines) {
      const c = l.coords.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      m[l.id] = {
        section: l.section,
        earth: EARTH,
        wells: [],
        line: c.length >= 2
          ? { p0: c[0], p1: c[c.length - 1] }
          : { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 } },
      };
    }
    return m;
  }, [fieldA, fieldB, segyLines]);
  const field = fields[lineId] ?? null;
  const importedLine = segyLines.find((l) => l.id === lineId) ?? null;
  const isImported = !!importedLine;

  /** Synthetic lines plus every imported one, in selector order. */
  const lineOptions = useMemo(
    () => [
      ...LINES.filter((l) => fields[l.id]).map((l) => ({ id: l.id as LineId, label: l.label, imported: false })),
      ...segyLines.map((l) => ({ id: l.id, label: l.label, imported: true })),
    ],
    [fields, segyLines],
  );
  const lineLabel = (id: LineId) => lineOptions.find((l) => l.id === id)?.label ?? id;

  const horizonList = useMemo(() => {
    if (!field) return [];
    const by = new Map<string, { color: string; sum: number; n: number }>();
    for (const w of field.wells) for (const t of w.tops) {
      const e = by.get(t.label) ?? { color: t.color, sum: 0, n: 0 };
      e.sum += t.twt; e.n++; by.set(t.label, e);
    }
    return [...by.entries()].map(([label, e]) => ({ label, color: e.color, seedTwt: e.sum / e.n }));
  }, [field]);

  // Drop stale picks on both lines when the underlying wells/markers change —
  // switching which line is on screen must NOT clear the other line's work.
  useEffect(() => { setEdits({}); }, [coordWells, markers]);

  // Plot geometry — shared by the draw effect and the pointer handlers.
  const geom = useMemo(() => {
    if (!field) return null;
    const L = 56, R = 16, T = 26, B = 30;
    const pw = size.w - L - R, ph = size.h - T - B;
    const { t0, nSamples, dt } = field.section;
    const tEnd = t0 + nSamples * dt;
    return {
      L, T, pw, ph, t0, tEnd, ok: pw >= 40 && ph >= 40,
      xOf: (f: number) => L + f * pw,
      yOf: (t: number) => T + ((t - t0) / (tEnd - t0)) * ph,
      twtOfY: (y: number) => t0 + ((y - T) / ph) * (tEnd - t0),
    };
  }, [field, size]);

  // Interpolated per-trace horizon from the (edited) nodes.
  const horizonTwt = useMemo(
    () => (edit && field ? interpolateHorizon(edit.nodes, field.section.nTraces) : null),
    [edit, field],
  );

  // Horizon → control points → surface via the shared framework service, plus
  // how well the seismic depth agrees with the well picks.
  const pick = useMemo(() => {
    if (!field || !horizonTwt || !edit) return null;
    const controls = horizonControls(field, horizonTwt, conv);
    const zs = controls.map((c) => c.z), xs = controls.map((c) => c.x), ys = controls.map((c) => c.y);
    const surface = buildSurface(controls, { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), nx: 40, ny: 40 });
    // Tie error: the converted picked depth vs the well's KNOWN depth — this is the
    // model error the calibration minimises (not just tracking error).
    let maxMiss = 0;
    for (const w of field.wells) {
      const top = w.tops.find((t) => t.label === edit.label);
      if (!top) continue;
      const i = Math.round(w.f * (field.section.nTraces - 1));
      maxMiss = Math.max(maxMiss, Math.abs(twtToDepth(conv, horizonTwt[i]) - top.depth));
    }
    return {
      controls, n: controls.length,
      twtMin: Math.min(...horizonTwt), twtMax: Math.max(...horizonTwt),
      zMin: Math.min(...zs), zMax: Math.max(...zs),
      nx: surface?.grid.nx ?? 0, ny: surface?.grid.ny ?? 0, maxMiss,
    };
  }, [field, horizonTwt, edit, conv]);

  // Conversion-velocity range across the section's time window, for the badge.
  const velInfo = useMemo(() => {
    if (!field) return null;
    const { t0, nSamples, dt } = field.section;
    const zTop = twtToDepth(conv, t0);
    const zBot = twtToDepth(conv, t0 + nSamples * dt);
    return { vTop: Math.round(velocityAt(conv, zTop)), vBot: Math.round(velocityAt(conv, zBot)) };
  }, [field, conv]);

  // How well the conversion velocity ties the wells' own time↔depth pairs — the
  // pure velocity residual the calibration minimises (no picking involved).
  const velTie = useMemo(() => {
    if (!field) return null;
    let max = 0, ties = 0;
    for (const w of field.wells) for (const t of w.tops) {
      max = Math.max(max, Math.abs(twtToDepth(conv, t.twt) - t.depth));
      ties++;
    }
    // No picks means nothing to tie to — showing a green "±0 м" would read as a
    // perfect match when it is really an absence of evidence.
    return ties > 0 ? max : null;
  }, [field, conv]);

  // Where the two lines physically cross, and — if the same horizon is picked on
  // both — the loop-tie mistie between them there. This is what makes a second
  // line worth having: an independent check on the first line's pick.
  const crossing = useMemo(() => {
    if (!fieldA || !fieldB) return null;
    const hit = segmentIntersection(fieldA.line.p0, fieldA.line.p1, fieldB.line.p0, fieldB.line.p1);
    if (!hit) return null;
    const editA = edits.A, editB = edits.B;
    if (!editA || !editB || editA.label !== editB.label) return { hit, tie: null };
    const twtA = interpolateHorizon(editA.nodes, fieldA.section.nTraces);
    const twtB = interpolateHorizon(editB.nodes, fieldB.section.nTraces);
    const zA = twtToDepth(conv, sampleHorizonAt(twtA, hit.fa * (fieldA.section.nTraces - 1)));
    const zB = twtToDepth(conv, sampleHorizonAt(twtB, hit.fb * (fieldB.section.nTraces - 1)));
    return { hit, tie: { label: editA.label, zA, zB, mistie: Math.abs(zA - zB) } };
  }, [fieldA, fieldB, edits, conv]);

  // Nudge to pick the same horizon on the other line once one side is picked and
  // the lines do cross — otherwise there's nothing to compare at the crossing.
  const crossHint = useMemo(() => {
    if (!edit || !crossing?.hit) return null;
    const other: LineId = lineId === 'A' ? 'B' : 'A';
    if (edits[other]?.label === edit.label) return null; // already comparable — shown as the tie row instead
    return `Снимите «${edit.label}» и на линии ${lineLabel(other)}, чтобы сверить на пересечении.`;
  }, [edit, crossing, lineId, edits]);

  const snap = (label: string, color: string, seedTwt: number) => {
    if (!field) return;
    setEdit({ label, color, nodes: sampleNodes(autoTrackHorizon(field.section, seedTwt), NODE_COUNT) });
  };

  // Fit v0/k so the wells' picked times convert to their known depths, and pull
  // any active pick(s) — on either line — exactly onto the well ties. Calibration
  // alone can't close the gap at a well: the demo reflector is a straight line
  // through the two OUTER wells, so an inner well's true top needn't sit on it.
  // Tying is the standard next interpretation step once you trust the wells.
  const calibrate = () => {
    if (!field) return;
    const samples: VelocitySample[] = field.wells.flatMap((w) => w.tops.map((t) => ({ depth: t.depth, twt: t.twt })));
    setCalModel(calibrateVelocity(samples));
    setConvKey('cal');
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of ['A', 'B'] as LineId[]) {
        const f = fields[id], e = prev[id];
        if (f && e) next[id] = { ...e, nodes: tieToWells(f, e.label, e.nodes) };
      }
      return next;
    });
  };

  // --- Node drag editing ---
  const nearestNode = (mx: number, my: number): number | null => {
    if (!edit || !geom || !field) return null;
    const n = field.section.nTraces;
    let best: number | null = null, bestD = 13;
    edit.nodes.forEach((nd, k) => {
      const d = Math.hypot(geom.xOf(nd.i / (n - 1)) - mx, geom.yOf(nd.twt) - my);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  };
  const mouse = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top };
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const { mx, my } = mouse(e);
    // An imported line carries no well tops, so there is nothing to seed a pick
    // from: the click itself is the seed. Autotracking then follows the event
    // from there exactly as it does on a synthetic line.
    if (!edit) {
      if (isImported && geom && field && mx > geom.L && my > geom.T) {
        snap(String(pickSeq), '#AF52DE', clamp(geom.twtOfY(my), geom.t0, geom.tEnd));
      }
      return;
    }
    const k = nearestNode(mx, my);
    if (k != null) { dragRef.current = k; canvasRef.current!.setPointerCapture(e.pointerId); }
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!edit) {
      if (canvasRef.current) canvasRef.current.style.cursor = isImported ? 'crosshair' : 'default';
      return;
    }
    if (!geom) return;
    const { mx, my } = mouse(e);
    if (dragRef.current == null) {
      canvasRef.current!.style.cursor = nearestNode(mx, my) != null ? 'grab' : 'default';
      return;
    }
    const twt = clamp(geom.twtOfY(my), geom.t0, geom.tEnd);
    const nodes = edit.nodes.map((nd, k) => (k === dragRef.current ? { ...nd, twt } : nd));
    setEdit({ ...edit, nodes });
  };
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current != null) { canvasRef.current!.releasePointerCapture(e.pointerId); dragRef.current = null; }
  };

  const image = useMemo(() => {
    if (!field) return null;
    const { nTraces, nSamples, amp, ampMax } = field.section;
    const off = document.createElement('canvas');
    off.width = nTraces; off.height = nSamples;
    const octx = off.getContext('2d');
    if (!octx) return null;
    const img = octx.createImageData(nTraces, nSamples);
    for (let i = 0; i < nTraces; i++) {
      for (let s = 0; s < nSamples; s++) {
        const [r, g, b] = seismicColor(amp[i * nSamples + s] / ampMax);
        const p = (s * nTraces + i) * 4;
        img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return off;
  }, [field]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !field || !image || !geom || !geom.ok) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr; canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const text = v('--text', '#f4f7fa'), text3 = v('--text-3', '#636e83'), border = v('--border', 'rgba(151,178,196,0.16)');
    ctx.font = '11px ui-monospace, monospace';

    const { L, T, pw, ph, t0, tEnd, xOf, yOf } = geom;
    const { section } = field;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, L, T, pw, ph);
    ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);

    // Time axis (ms, down).
    ctx.fillStyle = text3; ctx.textAlign = 'right';
    const step = niceStep((tEnd - t0) / 7);
    for (let t = Math.ceil(t0 / step) * step; t <= tEnd; t += step) {
      const y = yOf(t);
      ctx.fillText(String(Math.round(t)), L - 8, y + 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    }
    ctx.save(); ctx.translate(15, T + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.fillText('TWT, мс', 0, 0); ctx.restore();

    // Wells + tie markers.
    for (const w of field.wells) {
      const x = xOf(w.f);
      ctx.strokeStyle = 'rgba(244,247,250,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.fillText(w.name, x, T - 8);
      for (const top of w.tops) {
        const y = yOf(top.twt);
        if (y < T || y > T + ph) continue;
        ctx.strokeStyle = top.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.stroke();
        ctx.fillStyle = top.color; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Where the other line crosses this one — a small tick on the time axis.
    if (crossing?.hit) {
      const fx = lineId === 'A' ? crossing.hit.fa : crossing.hit.fb;
      const x = xOf(fx);
      const accent2 = v('--accent-2', '#34d1a8');
      ctx.strokeStyle = accent2;
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = accent2; ctx.textAlign = 'center';
      ctx.fillText('×', x, T + ph + 14);
    }

    // Editable horizon: interpolated line + draggable node handles.
    if (edit && horizonTwt) {
      const n = section.nTraces;
      ctx.strokeStyle = edit.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xOf(n > 1 ? i / (n - 1) : 0), y = yOf(horizonTwt[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (const nd of edit.nodes) {
        const x = xOf(nd.i / (n - 1)), y = yOf(nd.twt);
        ctx.fillStyle = edit.color; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    // Amplitude legend.
    const lw = 96, lh = 8, lx = L + pw - lw - 8, ly = T + ph - 20;
    for (let i = 0; i < lw; i++) { const [r, g, b] = seismicColor((i / lw) * 2 - 1); ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(lx + i, ly, 1, lh); }
    ctx.strokeStyle = border; ctx.strokeRect(lx, ly, lw, lh);
    ctx.fillStyle = text3; ctx.textAlign = 'center'; ctx.fillText('амплитуда −/+', lx + lw / 2, ly - 5);
  }, [field, image, size, geom, edit, horizonTwt, crossing, lineId]);

  if (wells.length === 0) {
    return <div className="placeholder"><div className="pc"><h3>Сейсмика</h3><p>Загрузите скважины — здесь появится синтетический сейсмо-разрез вдоль линии скважин с привязкой кровель.</p></div></div>;
  }
  if (!field) {
    return <div className="placeholder"><div className="pc"><h3>Сейсмика</h3><p>Нужны ≥2 скважины с координатами, чтобы построить линию разреза.</p></div></div>;
  }

  const inMap = edit ? !!seismicHorizons[edit.label]?.[lineId] : false;

  return (
    <div className="seismic" ref={wrapRef}>
      <canvas ref={canvasRef} className="seismic-canvas" style={{ width: size.w, height: size.h }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} />

      <div className="seismic-panel">
        <div className="seismic-panel-h">Линия</div>
        <div className="seismic-picks">
          {lineOptions.map((l) => (
            <button key={l.id} className={`seismic-pick ${lineId === l.id ? 'on' : ''}`} onClick={() => setLineId(l.id)}
              title={l.imported ? 'Импортированный SEG-Y' : 'Синтетическая линия вдоль скважин'}>
              {edits[l.id] && <span className="seismic-dot" style={{ background: edits[l.id]!.color }} />}
              {l.imported ? '▤ ' : ''}{l.label}
            </button>
          ))}
        </div>

        {!isImported && horizonList.length > 0 && (
          <>
            <div className="seismic-panel-h seismic-panel-h2">Снять горизонт</div>
            <SurfacePicker
              label="Пласт"
              options={horizonList.map((h) => ({ id: h.label, label: h.label, color: h.color }))}
              value={edit?.label}
              onChange={(label) => {
                const h = horizonList.find((x) => x.label === label);
                if (h) snap(h.label, h.color, h.seedTwt);
              }}
            />
            {edit && <div className="seismic-hint">Перетащите узлы, чтобы поправить горизонт.</div>}
            {crossHint && <div className="seismic-hint">{crossHint}</div>}
          </>
        )}

        {isImported && (
          <>
            <div className="seismic-panel-h seismic-panel-h2">Горизонт</div>
            {edit ? (
              <>
                <div className="seismic-hint">Перетащите узлы, чтобы поправить горизонт.</div>
                <button className="seismic-remove" onClick={() => { setEdit(null); setPickSeq((n) => n + 1); }}>
                  снять заново
                </button>
              </>
            ) : (
              // No well tops exist on an imported line, so the click is the seed.
              <div className="seismic-hint">Кликните по отражателю — горизонт протрассируется от этой точки.</div>
            )}
          </>
        )}
      </div>

      {pick && edit && (
        <aside className="seismic-result">
          <div className="seismic-result-h"><span className="seismic-dot" style={{ background: edit.color }} />Горизонт {edit.label} · {lineLabel(lineId)}</div>
          <div className="seismic-row"><span>Узлов</span><b>{edit.nodes.length}</b></div>
          <div className="seismic-row"><span>TWT</span><b>{Math.round(pick.twtMin)}–{Math.round(pick.twtMax)} мс</b></div>
          <div className="seismic-row"><span>Глубина</span><b>{Math.round(pick.zMin)}–{Math.round(pick.zMax)} м</b></div>
          <div className="seismic-row"><span>→ buildSurface</span><b>{pick.nx}×{pick.ny}</b></div>
          {!isImported && (
            <div className="seismic-row strong"><span>Согласие со скв.</span><b>±{pick.maxMiss.toFixed(1)} м</b></div>
          )}
          {crossing?.tie && crossing.tie.label === edit.label && (
            <div className="seismic-row strong">
              <span title="Разница глубин той же кровли на пересечении двух линий">Пересеч. линий</span>
              <b>±{crossing.tie.mistie.toFixed(1)} м</b>
            </div>
          )}
          {isImported ? (
            <div className="seismic-note">
              Координаты этой съёмки — в своей системе (в заголовке <code>CRS: &lt;undef&gt;</code>) и не совпадают
              с координатами скважин. Пока преобразование неизвестно, перенос в карту дал бы неверное положение,
              поэтому он отключён.
            </div>
          ) : (
            <>
              <div className="seismic-note">Горизонт → контрольные точки → каркас (тот же <code>buildSurface</code>, что и для скважин).</div>
              <button className="seismic-apply" onClick={() => setSeismicHorizon(edit.label, lineId, pick.controls)}>
                {inMap ? 'Обновить в карте' : 'Использовать в карте'}
              </button>
              {inMap && <button className="seismic-remove" onClick={() => clearSeismicHorizon(edit.label, lineId)}>убрать из карты</button>}
            </>
          )}
        </aside>
      )}

      <div className="seismic-vel">
        <span className="seismic-vel-l">Глубина</span>
        <button className={`seismic-vel-btn ${convKey === 'const' ? 'on' : ''}`} onClick={() => setConvKey('const')}>Постоянная</button>
        <button className={`seismic-vel-btn ${convKey === 'linear' ? 'on' : ''}`} onClick={() => setConvKey('linear')}>Компакция</button>
        {checkshotModel && (
          <button className={`seismic-vel-btn cal ${convKey === 'checkshot' ? 'on' : ''}`}
            onClick={() => setConvKey('checkshot')}
            title="Измеренная связь время–глубина по чекшотам — не подгонка, а факт">Чекшоты</button>
        )}
        <button className={`seismic-vel-btn cal ${convKey === 'cal' ? 'on' : ''}`} onClick={calibrate}
          title="Подбирает V₀/k по кровлям и притягивает снятые горизонты точно на скважины (на обеих линиях)">Калибровать по скв.</button>
        {velTie != null && <span className={`seismic-vel-tie ${velTie < 8 ? 'ok' : ''}`} title="невязка v-модели по кровлям скважин">тай ±{Math.round(velTie)} м</span>}
      </div>

      <div className="seismic-badge">
        {isImported ? `SEG-Y · ${lineLabel(lineId)}` : `Линия ${lineId} (${lineLabel(lineId)})`} · {field.section.nTraces} трасс · {conv.kind === 'const'
          ? `v = ${conv.v} м/с`
          : `v = ${velInfo?.vTop}→${velInfo?.vBot} м/с`}
        {convKey === 'checkshot' && checkshotModel?.kind === 'table' && (
          <span className="seismic-cal"> · {checkshotModel.label}</span>
        )}
        {convKey === 'cal' && calModel && (
          <span className="seismic-cal"> · калибр. {calModel.kind === 'linear'
            ? `V₀=${calModel.v0}, k=${calModel.k}`
            : calModel.kind === 'const' ? `V=${calModel.v}` : 'по чекшотам'}</span>
        )}
      </div>
    </div>
  );
}
