import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Marker, Well } from '../types';
import {
  buildFieldSection, autoTrackHorizon, horizonControls,
  sampleNodes, interpolateHorizon, type HorizonNode,
} from '../seismic';
import { buildSurface } from '../core/framework';
import {
  twtToDepth, velocityAt, calibrateVelocity, DEFAULT_VELOCITY, COMPACTION,
  type VelocityModel, type VelocitySample,
} from '../core/velocity';
import { useStore } from '../store';

interface Props {
  wells: Well[];
  markers: Marker[];
}

type ConvKey = 'const' | 'linear' | 'cal';
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

/** 2D seismic section with tie-posted wells and an editable, draggable horizon. */
export function SeismicView({ wells, markers }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<number | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [edit, setEdit] = useState<{ label: string; color: string; nodes: HorizonNode[] } | null>(null);
  const [convKey, setConvKey] = useState<ConvKey>('const');
  const [calModel, setCalModel] = useState<VelocityModel | null>(null);
  const seismicHorizons = useStore((s) => s.seismicHorizons);
  const setSeismicHorizon = useStore((s) => s.setSeismicHorizon);
  const clearSeismicHorizon = useStore((s) => s.clearSeismicHorizon);

  // The conversion velocity applied to picked times (independent of the earth truth
  // the section was built with). Switching it re-converts live — it does NOT rebuild
  // the section, so the picked horizon survives.
  const conv = useMemo<VelocityModel>(
    () => (convKey === 'cal' && calModel ? calModel : CONV_PRESETS[convKey === 'cal' ? 'const' : convKey]),
    [convKey, calModel],
  );
  const coordWells = useMemo(() => wells.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)), [wells]);
  const field = useMemo(() => buildFieldSection(coordWells, markers), [coordWells, markers]);

  const horizonList = useMemo(() => {
    if (!field) return [];
    const by = new Map<string, { color: string; sum: number; n: number }>();
    for (const w of field.wells) for (const t of w.tops) {
      const e = by.get(t.label) ?? { color: t.color, sum: 0, n: 0 };
      e.sum += t.twt; e.n++; by.set(t.label, e);
    }
    return [...by.entries()].map(([label, e]) => ({ label, color: e.color, seedTwt: e.sum / e.n }));
  }, [field]);

  useEffect(() => { setEdit(null); }, [field]); // drop a stale pick when the field changes

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
      const i = Math.round(w.xFrac * (field.section.nTraces - 1));
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
    let max = 0;
    for (const w of field.wells) for (const t of w.tops) max = Math.max(max, Math.abs(twtToDepth(conv, t.twt) - t.depth));
    return max;
  }, [field, conv]);

  const snap = (label: string, color: string, seedTwt: number) => {
    if (!field) return;
    setEdit({ label, color, nodes: sampleNodes(autoTrackHorizon(field.section, seedTwt), NODE_COUNT) });
  };

  // Fit v0/k so the wells' picked times convert to their known depths.
  const calibrate = () => {
    if (!field) return;
    const samples: VelocitySample[] = field.wells.flatMap((w) => w.tops.map((t) => ({ depth: t.depth, twt: t.twt })));
    setCalModel(calibrateVelocity(samples));
    setConvKey('cal');
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
    if (!edit) return;
    const { mx, my } = mouse(e);
    const k = nearestNode(mx, my);
    if (k != null) { dragRef.current = k; canvasRef.current!.setPointerCapture(e.pointerId); }
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!edit || !geom) return;
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
      const x = xOf(w.xFrac);
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
  }, [field, image, size, geom, edit, horizonTwt]);

  if (wells.length === 0) {
    return <div className="placeholder"><div className="pc"><h3>Сейсмика</h3><p>Загрузите скважины — здесь появится синтетический сейсмо-разрез вдоль линии скважин с привязкой кровель.</p></div></div>;
  }
  if (!field) {
    return <div className="placeholder"><div className="pc"><h3>Сейсмика</h3><p>Нужны ≥2 скважины с координатами, чтобы построить линию разреза.</p></div></div>;
  }

  const inMap = edit ? !!seismicHorizons[edit.label] : false;

  return (
    <div className="seismic" ref={wrapRef}>
      <canvas ref={canvasRef} className="seismic-canvas" style={{ width: size.w, height: size.h }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} />

      {horizonList.length > 0 && (
        <div className="seismic-panel">
          <div className="seismic-panel-h">Снять горизонт</div>
          <div className="seismic-picks">
            {horizonList.map((h) => (
              <button key={h.label} className={`seismic-pick ${edit?.label === h.label ? 'on' : ''}`}
                onClick={() => snap(h.label, h.color, h.seedTwt)}>
                <span className="seismic-dot" style={{ background: h.color }} />{h.label}
              </button>
            ))}
          </div>
          {edit && <div className="seismic-hint">Перетащите узлы, чтобы поправить горизонт.</div>}
        </div>
      )}

      {pick && edit && (
        <aside className="seismic-result">
          <div className="seismic-result-h"><span className="seismic-dot" style={{ background: edit.color }} />Горизонт {edit.label}</div>
          <div className="seismic-row"><span>Узлов</span><b>{edit.nodes.length}</b></div>
          <div className="seismic-row"><span>TWT</span><b>{Math.round(pick.twtMin)}–{Math.round(pick.twtMax)} мс</b></div>
          <div className="seismic-row"><span>Глубина</span><b>{Math.round(pick.zMin)}–{Math.round(pick.zMax)} м</b></div>
          <div className="seismic-row"><span>→ buildSurface</span><b>{pick.nx}×{pick.ny}</b></div>
          <div className="seismic-row strong"><span>Согласие со скв.</span><b>±{pick.maxMiss.toFixed(1)} м</b></div>
          <div className="seismic-note">Горизонт → контрольные точки → каркас (тот же <code>buildSurface</code>, что и для скважин).</div>
          <button className="seismic-apply" onClick={() => setSeismicHorizon(edit.label, pick.controls)}>
            {inMap ? 'Обновить в карте' : 'Использовать в карте'}
          </button>
          {inMap && <button className="seismic-remove" onClick={() => clearSeismicHorizon(edit.label)}>убрать из карты</button>}
        </aside>
      )}

      <div className="seismic-vel">
        <span className="seismic-vel-l">Глубина</span>
        <button className={`seismic-vel-btn ${convKey === 'const' ? 'on' : ''}`} onClick={() => setConvKey('const')}>Постоянная</button>
        <button className={`seismic-vel-btn ${convKey === 'linear' ? 'on' : ''}`} onClick={() => setConvKey('linear')}>Компакция</button>
        <button className={`seismic-vel-btn cal ${convKey === 'cal' ? 'on' : ''}`} onClick={calibrate}>Калибровать по скв.</button>
        {velTie != null && <span className={`seismic-vel-tie ${velTie < 8 ? 'ok' : ''}`} title="невязка v-модели по кровлям скважин">тай ±{Math.round(velTie)} м</span>}
      </div>

      <div className="seismic-badge">
        Синтетический разрез · {field.section.nTraces} трасс · {conv.kind === 'const'
          ? `v = ${conv.v} м/с`
          : `v = ${velInfo?.vTop}→${velInfo?.vBot} м/с`}
        {convKey === 'cal' && calModel && (
          <span className="seismic-cal"> · калибр. {calModel.kind === 'linear'
            ? `V₀=${calModel.v0}, k=${calModel.k}` : `V=${calModel.v}`}</span>
        )}
      </div>
    </div>
  );
}
