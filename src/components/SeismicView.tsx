import { useEffect, useMemo, useRef, useState } from 'react';
import type { Marker, Well } from '../types';
import { buildFieldSection, autoTrackHorizon, horizonControls, twtToDepth } from '../seismic';
import { buildSurface } from '../core/framework';
import { useStore } from '../store';

interface Props {
  wells: Well[];
  markers: Marker[];
}

const VELOCITY = 2200; // m/s, constant depth↔TWT for the demo
const niceStep = (raw: number) => { const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p; };

/** Dark variable-density seismic: near-black at zero, red for +, cyan-blue for −. */
function seismicColor(v: number): [number, number, number] {
  const a = Math.min(1, Math.abs(v));
  return v >= 0 ? [30 + 225 * a, 34 + 36 * a, 34] : [30, 44 + 120 * a, 44 + 211 * a];
}

/** 2D seismic section (synthetic) along the wells, with tops posted as ties. */
export function SeismicView({ wells, markers }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [picked, setPicked] = useState<{ label: string; color: string; twt: Float64Array } | null>(null);
  const seismicHorizons = useStore((s) => s.seismicHorizons);
  const setSeismicHorizon = useStore((s) => s.setSeismicHorizon);
  const clearSeismicHorizon = useStore((s) => s.clearSeismicHorizon);

  const coordWells = useMemo(() => wells.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)), [wells]);
  const field = useMemo(() => buildFieldSection(coordWells, markers, VELOCITY), [coordWells, markers]);

  // Distinct tops on the line, each pickable as a horizon (seeded at its tie TWT).
  const horizonList = useMemo(() => {
    if (!field) return [];
    const by = new Map<string, { color: string; sum: number; n: number }>();
    for (const w of field.wells) for (const t of w.tops) {
      const e = by.get(t.label) ?? { color: t.color, sum: 0, n: 0 };
      e.sum += t.twt; e.n++; by.set(t.label, e);
    }
    return [...by.entries()].map(([label, e]) => ({ label, color: e.color, seedTwt: e.sum / e.n }));
  }, [field]);

  useEffect(() => { setPicked(null); }, [field]); // drop a stale pick when the field changes

  // Snapped horizon → depth control points → surface via the shared framework
  // service, plus how well the seismic depth agrees with the well picks.
  const pick = useMemo(() => {
    if (!field || !picked) return null;
    const controls = horizonControls(field, picked.twt);
    const zs = controls.map((c) => c.z), xs = controls.map((c) => c.x), ys = controls.map((c) => c.y);
    const surface = buildSurface(controls, {
      minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), nx: 40, ny: 40,
    });
    // Validate against the wells that picked this top.
    let maxMiss = 0;
    for (const w of field.wells) {
      const top = w.tops.find((t) => t.label === picked.label);
      if (!top) continue;
      const i = Math.round(w.xFrac * (field.section.nTraces - 1));
      const seisDepth = twtToDepth(picked.twt[i], field.velocity);
      maxMiss = Math.max(maxMiss, Math.abs(seisDepth - twtToDepth(top.twt, field.velocity)));
    }
    return {
      controls,
      n: controls.length,
      twtMin: Math.min(...picked.twt), twtMax: Math.max(...picked.twt),
      zMin: Math.min(...zs), zMax: Math.max(...zs),
      gridded: !!surface, nx: surface?.grid.nx ?? 0, ny: surface?.grid.ny ?? 0,
      maxMiss,
    };
  }, [field, picked]);

  const snap = (label: string, color: string, seedTwt: number) => {
    if (!field) return;
    setPicked({ label, color, twt: autoTrackHorizon(field.section, seedTwt) });
  };

  // Section rasterised once (data space) into an offscreen image.
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
    if (!canvas || !field || !image) return;
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

    const L = 56, R = 16, T = 26, B = 30;
    const pw = size.w - L - R, ph = size.h - T - B;
    if (pw < 40 || ph < 40) return;

    // Section raster.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, L, T, pw, ph);
    ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);

    const { section } = field;
    const tEnd = section.t0 + section.nSamples * section.dt;
    const yOf = (t: number) => T + ((t - section.t0) / (tEnd - section.t0)) * ph;
    const xOf = (f: number) => L + f * pw;

    // Time axis (ms, down).
    ctx.fillStyle = text3; ctx.textAlign = 'right';
    const step = niceStep((tEnd - section.t0) / 7);
    for (let t = Math.ceil(section.t0 / step) * step; t <= tEnd; t += step) {
      const y = yOf(t);
      ctx.fillText(String(Math.round(t)), L - 8, y + 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    }
    ctx.save(); ctx.translate(15, T + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.fillText('TWT, мс', 0, 0); ctx.restore();

    // Wells posted along the line + tops as tie markers.
    for (const w of field.wells) {
      const x = xOf(w.xFrac);
      ctx.strokeStyle = 'rgba(244,247,250,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      ctx.fillStyle = text; ctx.textAlign = 'center';
      ctx.fillText(w.name, x, T - 8);
      for (const top of w.tops) {
        const y = yOf(top.twt);
        if (y < T || y > T + ph) continue;
        ctx.strokeStyle = top.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.stroke();
        ctx.fillStyle = top.color; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Picked horizon overlay (bright line following the tracked reflector).
    if (picked) {
      ctx.strokeStyle = picked.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      const n = section.nTraces;
      for (let i = 0; i < n; i++) {
        const x = xOf(n > 1 ? i / (n - 1) : 0), y = yOf(picked.twt[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Amplitude legend (blue — black — red).
    const lw = 96, lh = 8, lx = L + pw - lw - 8, ly = T + ph - 20;
    for (let i = 0; i < lw; i++) {
      const [r, g, b] = seismicColor((i / lw) * 2 - 1);
      ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(lx + i, ly, 1, lh);
    }
    ctx.strokeStyle = border; ctx.strokeRect(lx, ly, lw, lh);
    ctx.fillStyle = text3; ctx.textAlign = 'center'; ctx.fillText('амплитуда −/+', lx + lw / 2, ly - 5);
  }, [field, image, size, picked]);

  if (wells.length === 0) {
    return <div className="placeholder"><div className="pc"><h3>Сейсмика</h3><p>Загрузите скважины — здесь появится синтетический сейсмо-разрез вдоль линии скважин с привязкой кровель.</p></div></div>;
  }
  if (!field) {
    return <div className="placeholder"><div className="pc"><h3>Сейсмика</h3><p>Нужны ≥2 скважины с координатами, чтобы построить линию разреза.</p></div></div>;
  }

  return (
    <div className="seismic" ref={wrapRef}>
      <canvas ref={canvasRef} className="seismic-canvas" style={{ width: size.w, height: size.h }} />

      {horizonList.length > 0 && (
        <div className="seismic-panel">
          <div className="seismic-panel-h">Снять горизонт</div>
          <div className="seismic-picks">
            {horizonList.map((h) => (
              <button key={h.label} className={`seismic-pick ${picked?.label === h.label ? 'on' : ''}`}
                onClick={() => snap(h.label, h.color, h.seedTwt)}>
                <span className="seismic-dot" style={{ background: h.color }} />{h.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {pick && picked && (
        <aside className="seismic-result">
          <div className="seismic-result-h"><span className="seismic-dot" style={{ background: picked.color }} />Горизонт {picked.label}</div>
          <div className="seismic-row"><span>Точек</span><b>{pick.n}</b></div>
          <div className="seismic-row"><span>TWT</span><b>{Math.round(pick.twtMin)}–{Math.round(pick.twtMax)} мс</b></div>
          <div className="seismic-row"><span>Глубина</span><b>{Math.round(pick.zMin)}–{Math.round(pick.zMax)} м</b></div>
          <div className="seismic-row"><span>→ buildSurface</span><b>{pick.nx}×{pick.ny}</b></div>
          <div className="seismic-row strong"><span>Согласие со скв.</span><b>±{pick.maxMiss.toFixed(1)} м</b></div>
          <div className="seismic-note">Горизонт → контрольные точки → каркас (тот же <code>buildSurface</code>, что и для скважин).</div>
          <button className={`seismic-apply ${seismicHorizons[picked.label] ? 'on' : ''}`}
            onClick={() => (seismicHorizons[picked.label] ? clearSeismicHorizon(picked.label) : setSeismicHorizon(picked.label, pick.controls))}>
            {seismicHorizons[picked.label] ? '✓ в карте — убрать' : 'Использовать в карте'}
          </button>
        </aside>
      )}

      <div className="seismic-badge">
        Синтетический разрез · {field.section.nTraces} трасс · v = {field.velocity} м/с (демо)
      </div>
    </div>
  );
}
