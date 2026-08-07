import { useEffect, useMemo, useRef, useState } from 'react';
import type { Marker, Well } from '../types';
import { buildFieldSection } from '../seismic';

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

  const coordWells = useMemo(() => wells.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)), [wells]);
  const field = useMemo(() => buildFieldSection(coordWells, markers, VELOCITY), [coordWells, markers]);

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

    // Amplitude legend (blue — black — red).
    const lw = 96, lh = 8, lx = L + pw - lw - 8, ly = T + ph - 20;
    for (let i = 0; i < lw; i++) {
      const [r, g, b] = seismicColor((i / lw) * 2 - 1);
      ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(lx + i, ly, 1, lh);
    }
    ctx.strokeStyle = border; ctx.strokeRect(lx, ly, lw, lh);
    ctx.fillStyle = text3; ctx.textAlign = 'center'; ctx.fillText('амплитуда −/+', lx + lw / 2, ly - 5);
  }, [field, image, size]);

  if (wells.length === 0) {
    return <div className="placeholder"><div className="pc"><h3>Сейсмика</h3><p>Загрузите скважины — здесь появится синтетический сейсмо-разрез вдоль линии скважин с привязкой кровель.</p></div></div>;
  }
  if (!field) {
    return <div className="placeholder"><div className="pc"><h3>Сейсмика</h3><p>Нужны ≥2 скважины с координатами, чтобы построить линию разреза.</p></div></div>;
  }

  return (
    <div className="seismic" ref={wrapRef}>
      <canvas ref={canvasRef} className="seismic-canvas" style={{ width: size.w, height: size.h }} />
      <div className="seismic-badge">
        Синтетический разрез · {field.section.nTraces} трасс · v = {field.velocity} м/с (демо)
      </div>
    </div>
  );
}
