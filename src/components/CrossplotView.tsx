import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Marker, Well } from '../types';
import { collectSamples, curveMnemonics, pearson, histogram } from '../wells/crossplot';

interface Props {
  wells: Well[];
  markers: Marker[];
  activeWellId: string | null;
  /** Current zoom, as a percentage (null = default/fit) — for the app footer. */
  onZoomChange?: (pct: number | null) => void;
}

export interface CrossplotHandle {
  resetView: () => void;
}

const RAMP: [number, number, number][] = [
  [58, 107, 201], [58, 163, 201], [91, 184, 91], [232, 207, 58], [232, 145, 58], [214, 69, 69],
];
function ramp(t: number): string {
  const c = Math.max(0, Math.min(0.999, t)) * (RAMP.length - 1);
  const i = Math.floor(c), f = c - i, a = RAMP[i], b = RAMP[i + 1] ?? RAMP[i];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
const WELL_COLORS = ['#10a1ff', '#FF9500', '#09b37b', '#AF52DE', '#eb5757', '#00c7be', '#f2c94c', '#B6C2CE'];

const tf = (val: number, log: boolean) => (log ? (val > 0 ? Math.log10(val) : NaN) : val);
const isRes = (m: string) => /res|^rt$|ild|lld|at\d/i.test(m);
// Plot-rect margins — shared between `draw` and the wheel/drag handlers,
// which need to convert a cursor pixel back to a data (x, y) point.
const L = 62, R = 20, T = 22, B = 46;
const MIN_ZOOM_FRAC = 0.03;
const niceStep = (raw: number) => { const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p; };
const fmt = (v: number) => String(+v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 3));

export const CrossplotView = forwardRef<CrossplotHandle, Props>(function CrossplotView(
  { wells, markers, activeWellId, onZoomChange }, ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [mode, setMode] = useState<'scatter' | 'hist'>('scatter');
  const [scope, setScope] = useState<'all' | 'active'>('all');
  const [logX, setLogX] = useState(false);
  const [logY, setLogY] = useState(false);
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [color, setColor] = useState('Глубина');
  const [zoneTop, setZoneTop] = useState('');
  const [zoneBase, setZoneBase] = useState('');
  // Zoom/pan window (scatter mode only) in the same transformed (log or
  // linear) space the plot itself draws in — null = auto-fit to the samples.
  const [view, setView] = useState<{ xMin: number; xMax: number; yMin: number; yMax: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; start: { xMin: number; xMax: number; yMin: number; yMax: number } } | null>(null);

  const scoped = useMemo(
    () => (scope === 'active' && activeWellId ? wells.filter((w) => w.id === activeWellId) : wells),
    [wells, scope, activeWellId],
  );
  const mnems = useMemo(() => curveMnemonics(scoped), [scoped]);

  // Sensible defaults once curves are known.
  useEffect(() => {
    if (mnems.length === 0) return;
    const has = (re: RegExp) => mnems.find((m) => re.test(m));
    if (!mnems.includes(x)) setX(has(/nphi|tnph|phi/i) || mnems[0]);
    if (!mnems.includes(y)) setY(has(/rhob|den/i) || mnems[1] || mnems[0]);
  }, [mnems]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLogX(isRes(x)); }, [x]);
  useEffect(() => { setLogY(isRes(y)); }, [y]);

  const zone = useMemo(() => {
    const t = markers.find((m) => m.id === zoneTop), b = markers.find((m) => m.id === zoneBase);
    return t && b && t.id !== b.id ? { top: t, base: b } : null;
  }, [markers, zoneTop, zoneBase]);

  const zMnem = color === 'Скважина' || color === 'Глубина' ? null : color;
  const byWell = color === 'Скважина';

  const samples = useMemo(
    () => (x && y ? collectSamples(scoped, x, y, zMnem, zone) : []),
    [scoped, x, y, zMnem, zone],
  );
  const r = useMemo(() => (mode === 'scatter' ? pearson(samples, logX, logY) : NaN), [samples, logX, logY, mode]);
  const hist = useMemo(() => (mode === 'hist' ? histogram(samples.map((s) => s.x), 32) : null), [samples, mode]);

  /** Auto-fit domain in transformed (log/linear) space — the "no zoom"
   * default, and the outer bound zoom/pan can't go past. Hoisted out of
   * `draw` so the wheel/drag handlers can reference it too. */
  const autoDomain = useMemo(() => {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const s of samples) {
      const tx = tf(s.x, logX), ty = tf(s.y, logY);
      if (Number.isFinite(tx)) { if (tx < xMin) xMin = tx; if (tx > xMax) xMax = tx; }
      if (Number.isFinite(ty)) { if (ty < yMin) yMin = ty; if (ty > yMax) yMax = ty; }
    }
    if (!(xMax > xMin)) xMax = xMin + 1;
    if (!(yMax > yMin)) yMax = yMin + 1;
    if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return null;
    return { xMin, xMax, yMin, yMax };
  }, [samples, logX, logY]);

  // A zoom/pan window for one curve pairing (or transform) makes no sense
  // for another — reset whenever what's being plotted changes.
  useEffect(() => { setView(null); }, [x, y, logX, logY, mode, scope, zoneTop, zoneBase]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const wellIdx = useMemo(() => new Map(scoped.map((w, i) => [w.id, i])), [scoped]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr; canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const text = v('--text', '#f4f7fa'), text2 = v('--text-2', '#97b2c4'), text3 = v('--text-3', '#636e83'), grid = v('--plate-grid', 'rgba(151,178,196,0.10)'), border = v('--border', 'rgba(151,178,196,0.16)');
    ctx.font = '11px ui-monospace, monospace';

    const pw = size.w - L - R, ph = size.h - T - B;
    if (pw < 20 || ph < 20) return;

    const unit = (m: string) => scoped.flatMap((w) => w.curves).find((c) => c.mnemonic === m)?.unit || '';
    const axisLabel = (m: string, log: boolean) => `${m}${unit(m) ? ` [${unit(m)}]` : ''}${log ? ' (log)' : ''}`;

    if (mode === 'hist' && hist) {
      // --- Histogram of X ---
      if (hist.bins.length === 0) { ctx.fillStyle = text3; ctx.fillText('Нет данных', L + 8, T + 16); return; }
      const x0 = hist.bins[0].x0, x1 = hist.bins[hist.bins.length - 1].x1;
      const bx = (val: number) => L + ((val - x0) / (x1 - x0 || 1)) * pw;
      const by = (c: number) => T + ph - (c / hist.max) * ph;
      ctx.fillStyle = ramp(0.35);
      for (const b of hist.bins) {
        const px = bx(b.x0), pw2 = Math.max(1, bx(b.x1) - px - 1);
        ctx.fillRect(px, by(b.count), pw2, T + ph - by(b.count));
      }
      // axes
      ctx.strokeStyle = border; ctx.lineWidth = 1;
      ctx.strokeRect(L, T, pw, ph);
      ctx.fillStyle = text3; ctx.textAlign = 'center';
      const stepX = niceStep((x1 - x0) / 7);
      for (let t = Math.ceil(x0 / stepX) * stepX; t <= x1 + 1e-9; t += stepX) {
        const px = bx(t); ctx.fillText(fmt(t), px, T + ph + 16);
      }
      ctx.fillStyle = text; ctx.fillText(axisLabel(x, false), L + pw / 2, size.h - 8);
      ctx.save(); ctx.translate(16, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('частота', 0, 0); ctx.restore();
      ctx.textAlign = 'left'; ctx.fillStyle = text3;
      ctx.fillText(`N = ${samples.length}`, L + 6, T + 14);
      return;
    }

    // --- Scatter ---
    if (samples.length === 0) { ctx.fillStyle = text3; ctx.fillText('Нет общих сэмплов для выбранных кривых', L + 8, T + 16); ctx.strokeStyle = border; ctx.strokeRect(L, T, pw, ph); return; }
    if (!autoDomain) return;
    let zmin = Infinity, zmax = -Infinity;
    for (const s of samples) if (Number.isFinite(s.z)) { if (s.z < zmin) zmin = s.z; if (s.z > zmax) zmax = s.z; }
    const xmin = view?.xMin ?? autoDomain.xMin, xmax = view?.xMax ?? autoDomain.xMax;
    const ymin = view?.yMin ?? autoDomain.yMin, ymax = view?.yMax ?? autoDomain.yMax;
    const px = (tx: number) => L + ((tx - xmin) / (xmax - xmin)) * pw;
    const py = (ty: number) => T + ph - ((ty - ymin) / (ymax - ymin)) * ph;

    // grid + ticks
    ctx.strokeStyle = grid; ctx.fillStyle = text3; ctx.lineWidth = 1;
    const drawXTicks = (vals: number[]) => { ctx.textAlign = 'center'; for (const val of vals) { const p = px(tf(val, logX)); if (p < L - 1 || p > L + pw + 1) continue; ctx.beginPath(); ctx.moveTo(p, T); ctx.lineTo(p, T + ph); ctx.stroke(); ctx.fillText(fmt(val), p, T + ph + 16); } };
    const drawYTicks = (vals: number[]) => { ctx.textAlign = 'right'; for (const val of vals) { const p = py(tf(val, logY)); if (p < T - 1 || p > T + ph + 1) continue; ctx.beginPath(); ctx.moveTo(L, p); ctx.lineTo(L + pw, p); ctx.stroke(); ctx.fillText(fmt(val), L - 8, p + 4); } };
    const decades = (lo: number, hi: number) => { const out: number[] = []; for (let k = Math.floor(lo); k <= Math.ceil(hi); k++) out.push(Math.pow(10, k)); return out; };
    if (logX) drawXTicks(decades(xmin, xmax)); else { const st = niceStep((xmax - xmin) / 7); const t: number[] = []; for (let vv = Math.ceil(xmin / st) * st; vv <= xmax + 1e-9; vv += st) t.push(vv); drawXTicks(t); }
    if (logY) drawYTicks(decades(ymin, ymax)); else { const st = niceStep((ymax - ymin) / 6); const t: number[] = []; for (let vv = Math.ceil(ymin / st) * st; vv <= ymax + 1e-9; vv += st) t.push(vv); drawYTicks(t); }

    // points — clipped, since zoomed in some can fall outside the plot rect.
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    ctx.globalAlpha = samples.length > 4000 ? 0.35 : 0.6;
    const zspan = zmax - zmin || 1;
    for (const s of samples) {
      const tx = tf(s.x, logX), ty = tf(s.y, logY);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      ctx.fillStyle = byWell ? WELL_COLORS[(wellIdx.get(s.wellId) ?? 0) % WELL_COLORS.length]
        : Number.isFinite(s.z) ? ramp((s.z - zmin) / zspan) : '#8899a6';
      ctx.beginPath(); ctx.arc(px(tx), py(ty), 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.strokeStyle = border; ctx.strokeRect(L, T, pw, ph);
    // axis titles
    ctx.fillStyle = text; ctx.textAlign = 'center';
    ctx.fillText(axisLabel(x, logX), L + pw / 2, size.h - 8);
    ctx.save(); ctx.translate(16, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(axisLabel(y, logY), 0, 0); ctx.restore();

    // stats chip (dark backing so it stays readable over the points/grid)
    const stats = `N = ${samples.length}${Number.isFinite(r) ? `   r = ${r.toFixed(2)}` : ''}${zone ? `   ${zone.top.label}–${zone.base.label}` : ''}`;
    ctx.textAlign = 'left';
    const sw = ctx.measureText(stats).width;
    ctx.fillStyle = 'rgba(19, 23, 27, 0.74)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(L + 5, T + 5, sw + 14, 20, 5); ctx.fill(); }
    else ctx.fillRect(L + 5, T + 5, sw + 14, 20);
    ctx.fillStyle = text2;
    ctx.fillText(stats, L + 12, T + 18);

    // colour legend (top-right)
    const lw = 90, lh = 8, lx = L + pw - lw - 6, ly = T + 6;
    if (byWell) {
      ctx.textAlign = 'left';
      scoped.forEach((w, i) => {
        const yy = ly + i * 14; if (yy > T + ph - 6) return;
        ctx.fillStyle = WELL_COLORS[i % WELL_COLORS.length]; ctx.fillRect(lx + lw - 60, yy, 10, 10);
        ctx.fillStyle = text3; ctx.fillText(w.name, lx + lw - 46, yy + 9);
      });
    } else if (Number.isFinite(zmin)) {
      for (let i = 0; i < lw; i++) { ctx.fillStyle = ramp(i / lw); ctx.fillRect(lx + i, ly, 1, lh); }
      ctx.strokeStyle = border; ctx.strokeRect(lx, ly, lw, lh);
      ctx.fillStyle = text3; ctx.textAlign = 'left'; ctx.fillText(fmt(zmin), lx, ly + lh + 12);
      ctx.textAlign = 'right'; ctx.fillText(fmt(zmax), lx + lw, ly + lh + 12);
      ctx.textAlign = 'center'; ctx.fillText(color, lx + lw / 2, ly - 3);
    }
  }, [samples, mode, logX, logY, size, x, y, color, byWell, r, hist, zone, scoped, wellIdx, autoDomain, view]);

  const clampWindow = (lo: number, span: number, boundLo: number, boundHi: number): [number, number] => {
    let a = lo, b = lo + span;
    if (a < boundLo) { a = boundLo; b = boundLo + span; }
    if (b > boundHi) { b = boundHi; a = boundHi - span; }
    return [a, b];
  };
  const currentDomain = () => ({
    xMin: view?.xMin ?? autoDomain?.xMin ?? 0, xMax: view?.xMax ?? autoDomain?.xMax ?? 1,
    yMin: view?.yMin ?? autoDomain?.yMin ?? 0, yMax: view?.yMax ?? autoDomain?.yMax ?? 1,
  });
  const resetView = () => setView(null);
  useImperativeHandle(ref, () => ({ resetView }), []);
  useEffect(() => {
    if (!view || !autoDomain) { onZoomChange?.(null); return; }
    onZoomChange?.(Math.round(((autoDomain.xMax - autoDomain.xMin) / (view.xMax - view.xMin)) * 100));
  }, [view, autoDomain, onZoomChange]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'scatter' || !autoDomain) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, start: currentDomain() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !autoDomain) return;
    // Already showing the full extent — a pan has nowhere to go, so don't
    // manufacture a "zoomed" view (and footer chip) that's identical to auto.
    if (drag.start.xMax - drag.start.xMin >= autoDomain.xMax - autoDomain.xMin
      && drag.start.yMax - drag.start.yMin >= autoDomain.yMax - autoDomain.yMin) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pw = Math.max(10, rect.width - L - R), ph = Math.max(10, rect.height - T - B);
    const dx = -((e.clientX - drag.startX) / pw) * (drag.start.xMax - drag.start.xMin);
    const dy = ((e.clientY - drag.startY) / ph) * (drag.start.yMax - drag.start.yMin);
    const [xMin, xMax] = clampWindow(drag.start.xMin + dx, drag.start.xMax - drag.start.xMin, autoDomain.xMin, autoDomain.xMax);
    const [yMin, yMax] = clampWindow(drag.start.yMin + dy, drag.start.yMax - drag.start.yMin, autoDomain.yMin, autoDomain.yMax);
    setView({ xMin, xMax, yMin, yMax });
  };
  const onPointerUp = () => { dragRef.current = null; };

  // Native, non-passive listener — React's onWheel is registered passive at
  // the root, so preventDefault() inside a synthetic handler throws.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || mode !== 'scatter' || !autoDomain) return;
    const onWheelNative = (e: globalThis.WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pw = Math.max(10, rect.width - L - R), ph = Math.max(10, rect.height - T - B);
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const { xMin, xMax, yMin, yMax } = currentDomain();
      const xAtCursor = xMin + ((mx - L) / pw) * (xMax - xMin);
      const yAtCursor = yMax - ((my - T) / ph) * (yMax - yMin);
      const spanFactor = Math.exp(e.deltaY * 0.0015);
      const fullX = autoDomain.xMax - autoDomain.xMin, fullY = autoDomain.yMax - autoDomain.yMin;
      const newXSpan = Math.min(fullX, Math.max(fullX * MIN_ZOOM_FRAC, (xMax - xMin) * spanFactor));
      const newYSpan = Math.min(fullY, Math.max(fullY * MIN_ZOOM_FRAC, (yMax - yMin) * spanFactor));
      const relX = (mx - L) / pw, relY = 1 - (my - T) / ph;
      const [newXMin, newXMax] = clampWindow(xAtCursor - relX * newXSpan, newXSpan, autoDomain.xMin, autoDomain.xMax);
      const [newYMin, newYMax] = clampWindow(yAtCursor - relY * newYSpan, newYSpan, autoDomain.yMin, autoDomain.yMax);
      setView({ xMin: newXMin, xMax: newXMax, yMin: newYMin, yMax: newYMax });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, autoDomain, view]);

  if (wells.length === 0) {
    return <div className="placeholder"><div className="pc"><h3>Кроссплоты</h3><p>Загрузите скважины с каротажем — здесь появится кросс-анализ кривых (нейтрон–плотность, GR–сопротивление и др.).</p></div></div>;
  }
  if (mnems.length < 2) {
    return <div className="placeholder"><div className="pc"><h3>Кроссплоты</h3><p>Нужно ≥2 кривых каротажа в загруженных скважинах.</p></div></div>;
  }

  const Sel = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; t: string }[] }) => (
    <label className="xp-sel"><span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    </label>
  );
  const curveOpts = mnems.map((m) => ({ v: m, t: m }));
  const markerOpts = [{ v: '', t: '—' }, ...markers.map((m) => ({ v: m.id, t: m.label }))];

  return (
    <div className="xplot">
      <div className="xplot-bar">
        <div className="vol-src xp-mode">
          <button className={`vol-src-btn ${mode === 'scatter' ? 'on' : ''}`} onClick={() => setMode('scatter')}>Кроссплот</button>
          <button className={`vol-src-btn ${mode === 'hist' ? 'on' : ''}`} onClick={() => setMode('hist')}>Гистограмма</button>
        </div>
        <Sel label={mode === 'hist' ? 'Кривая' : 'X'} value={x} onChange={setX} options={curveOpts} />
        {mode === 'scatter' && <Sel label="Y" value={y} onChange={setY} options={curveOpts} />}
        {mode === 'scatter' && <Sel label="Цвет" value={color} onChange={setColor} options={[{ v: 'Глубина', t: 'Глубина' }, { v: 'Скважина', t: 'Скважина' }, ...curveOpts]} />}
        {mode === 'scatter' && (
          <div className="xp-logs">
            <label><input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} /> logX</label>
            <label><input type="checkbox" checked={logY} onChange={(e) => setLogY(e.target.checked)} /> logY</label>
          </div>
        )}
        <div className="vol-src xp-scope">
          <button className={`vol-src-btn ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>Все</button>
          <button className={`vol-src-btn ${scope === 'active' ? 'on' : ''}`} onClick={() => setScope('active')} disabled={!activeWellId}>Активная</button>
        </div>
        {markers.length >= 2 && (
          <div className="xp-zone">
            <span>Зона</span>
            <Sel label="" value={zoneTop} onChange={setZoneTop} options={markerOpts} />
            <Sel label="" value={zoneBase} onChange={setZoneBase} options={markerOpts} />
          </div>
        )}
      </div>
      <div className="xplot-plot" ref={wrapRef}>
        <canvas ref={canvasRef} className="xplot-canvas" style={{ width: size.w, height: size.h, cursor: mode === 'scatter' ? 'grab' : undefined }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
      </div>
    </div>
  );
});
