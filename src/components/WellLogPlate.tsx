import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Maximize2, Minimize2, Settings, Trash2, GitBranch } from 'lucide-react';
import type { Well, Template, LithoInterval, LithoPattern } from '../types';
import { defaultTemplate } from '../plate/template';
import { curveRange, valueToFrac } from '../plate/scales';

/** Special key for the lithology/saturation column in the hide-set. */
export const LITHO_KEY = '__litho__';

interface Props {
  well: Well;
  active?: boolean;
  onActivate?: () => void;
  onRemove?: () => void;
  /** Active tool; when 'marker', a click creates a correlation top. */
  tool?: string;
  onCreateMarker?: (depth: number) => void;
  /** Focus (fullscreen) state for this plate. */
  focused?: boolean;
  onToggleFocus?: () => void;
  /** Track titles / LITHO_KEY hidden for this well, plus a toggler. */
  hidden?: string[];
  onToggleTrack?: (key: string) => void;
  /** Shared depth window [top, bottom] in depth units, for correlation sync. */
  depthWindow: [number, number];
  onDepthWindowChange: (w: [number, number]) => void;
  cursorDepth: number | null;
  onCursorDepth: (d: number | null) => void;
  /** The shared horizontally-scrolling row of plates — dragging a plate pans
   * both its own depth window and this container's scroll in one gesture. */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

export const DEPTH_AXIS_W = 60;
export const HEADER_H = 54;
const LITHO_W = 30;
const SAT_W = 26;

/** Finite depth extent of the well. */
function wellDepthExtent(well: Well): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const d of well.depth) {
    if (!Number.isFinite(d)) continue;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

export function WellLogPlate({
  well,
  active = false,
  onActivate,
  onRemove,
  tool,
  onCreateMarker,
  focused = false,
  onToggleFocus,
  hidden,
  onToggleTrack,
  depthWindow,
  onDepthWindowChange,
  cursorDepth,
  onCursorDepth,
  scrollRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const template: Template = useMemo(() => defaultTemplate(well), [well]);
  const hiddenSet = useMemo(() => new Set(hidden ?? []), [hidden]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => { draw(); });

  // Native, non-passive wheel listener so preventDefault actually stops the page
  // from scrolling (React's onWheel is registered passive and can't).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [top, bottom] = depthWindow;
      const rect = canvasRef.current!.getBoundingClientRect();
      const plotH = rect.height - HEADER_H;
      const frac = Math.max(0, Math.min(1, (e.clientY - rect.top - HEADER_H) / plotH));
      const focus = top + frac * (bottom - top);
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      onDepthWindowChange([focus - (focus - top) * factor, focus + (bottom - focus) * factor]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [depthWindow, onDepthWindowChange]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue('--plate-bg').trim() || '#13171b';
    const grid = styles.getPropertyValue('--plate-grid').trim() || 'rgba(151,178,196,0.08)';
    const ink = styles.getPropertyValue('--plate-ink').trim() || '#97b2c4';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const [top, bottom] = depthWindow;
    const plotTop = HEADER_H;
    const plotH = h - HEADER_H;
    const depthToY = (d: number) => plotTop + ((d - top) / (bottom - top)) * plotH;

    // --- Depth axis ---
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const tickStep = niceStep((bottom - top) / 10);
    const firstTick = Math.ceil(top / tickStep) * tickStep;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let d = firstTick; d <= bottom; d += tickStep) {
      const y = depthToY(d);
      ctx.beginPath();
      ctx.moveTo(DEPTH_AXIS_W - 4, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillText(String(Math.round(d)), DEPTH_AXIS_W - 8, y);
    }

    // --- Column layout: [track0][litho][sat][tracks 1..], hidden columns skipped ---
    let x = DEPTH_AXIS_W;

    const tracks = template.tracks.filter((t) => !hiddenSet.has(t.title));
    const showLitho = well.lithology.length > 0 && !hiddenSet.has(LITHO_KEY);
    const drawCurveTrack = (track: Template['tracks'][number]) => {
      const tw = track.widthPx;
      ctx.strokeStyle = grid;
      ctx.strokeRect(x, plotTop, tw, plotH);
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillText(track.title, x + tw / 2, 14);

      track.curves.forEach((style, i) => {
        const curve = well.curves.find((c) => c.mnemonic === style.mnemonic);
        if (!curve) return;
        const range = curveRange(curve, style);
        ctx.fillStyle = style.color;
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(`${style.mnemonic} [${fmt(range[0])}–${fmt(range[1])}]`, x + tw / 2, 28 + i * 12);

        ctx.strokeStyle = style.color;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        let started = false;
        for (let k = 0; k < curve.values.length; k++) {
          const v = curve.values[k];
          const d = well.depth[k];
          if (v == null || !Number.isFinite(d) || d < top || d > bottom) { started = false; continue; }
          const frac = valueToFrac(v, range, style.scale);
          const px = x + Math.max(0, Math.min(1, frac)) * tw;
          const py = depthToY(d);
          if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
        }
        ctx.stroke();
      });
      x += tw;
    };

    // first curve track
    if (tracks[0]) drawCurveTrack(tracks[0]);

    // lithology + saturation columns
    if (showLitho) {
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillText('Литология', x + (LITHO_W + SAT_W) / 2, 14);
      for (const iv of well.lithology) {
        if (iv.base < top || iv.top > bottom) continue;
        const y0 = depthToY(Math.max(iv.top, top));
        const y1 = depthToY(Math.min(iv.base, bottom));
        drawLithoBlock(ctx, x + 2, y0 + 1, LITHO_W - 4, Math.max(1, y1 - y0 - 2), iv);
        if (iv.sat) drawSatBlock(ctx, x + LITHO_W + 2, y0 + 1, SAT_W - 4, Math.max(1, y1 - y0 - 2), iv.sat);
      }
      ctx.strokeStyle = grid;
      ctx.strokeRect(x, plotTop, LITHO_W, plotH);
      ctx.strokeRect(x + LITHO_W, plotTop, SAT_W, plotH);
      x += LITHO_W + SAT_W;
    }

    // remaining curve tracks
    for (let t = 1; t < tracks.length; t++) drawCurveTrack(tracks[t]);

    // --- Cursor depth line ---
    if (cursorDepth != null && cursorDepth >= top && cursorDepth <= bottom) {
      const y = depthToY(cursorDepth);
      ctx.strokeStyle = '#10a1ff';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(DEPTH_AXIS_W, y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // --- Interaction ---
  // Pointer capture (not plain mouse events) so a fast horizontal drag that
  // crosses into a neighbouring plate, or leaves the row entirely, keeps
  // delivering move/up events here instead of silently ending the pan.
  const dragRef = useRef<{ x: number; y: number; win: [number, number]; scrollLeft: number } | null>(null);
  function depthAtClientY(clientY: number): number {
    const rect = canvasRef.current!.getBoundingClientRect();
    const plotH = rect.height - HEADER_H;
    const [top, bottom] = depthWindow;
    const frac = Math.max(0, Math.min(1, (clientY - rect.top - HEADER_H) / plotH));
    return top + frac * (bottom - top);
  }
  function onPointerDown(e: React.PointerEvent) {
    onActivate?.();
    if (tool === 'marker' && onCreateMarker) {
      onCreateMarker(depthAtClientY(e.clientY));
      return; // don't start a pan when placing a marker
    }
    dragRef.current = {
      x: e.clientX, y: e.clientY, win: [...depthWindow] as [number, number],
      scrollLeft: scrollRef?.current?.scrollLeft ?? 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const plotH = rect.height - HEADER_H;
    const [top, bottom] = depthWindow;
    const frac = (e.clientY - rect.top - HEADER_H) / plotH;
    if (frac >= 0 && frac <= 1) onCursorDepth(top + frac * (bottom - top));
    if (dragRef.current) {
      const d = dragRef.current;
      const shift = -((e.clientY - d.y) / plotH) * (d.win[1] - d.win[0]);
      onDepthWindowChange([d.win[0] + shift, d.win[1] + shift]);
      if (scrollRef?.current) scrollRef.current.scrollLeft = d.scrollLeft - (e.clientX - d.x);
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const trackKeys = [
    ...template.tracks.map((t) => ({ key: t.title, label: t.title })),
    ...(well.lithology.length ? [{ key: LITHO_KEY, label: 'Литология' }] : []),
  ];

  return (
    <div className={`plate ${active ? 'active' : ''} ${focused ? 'focused' : ''}`} onMouseDownCapture={onActivate}>
      <div className="plate-title">
        <GitBranch className="pwell" size={15} strokeWidth={1.75} />
        <span className="pname">{well.name}</span>
        <span className="pmeta">{well.depthUnit}</span>
        <span className="psp" />
        <button className="pic" title="Удалить" onClick={onRemove}><Trash2 size={14} strokeWidth={1.75} /></button>
        <div className="pic-wrap">
          <button
            className={`pic ${settingsOpen ? 'on' : ''}`}
            title="Настройки треков"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            <Settings size={14} strokeWidth={1.75} />
          </button>
          {settingsOpen && (
            <>
              <div className="pic-scrim" onClick={() => setSettingsOpen(false)} />
              <div className="track-menu">
                <div className="track-menu-head">Колонки</div>
                {trackKeys.map((t) => (
                  <label key={t.key} className="track-row">
                    <input
                      type="checkbox"
                      checked={!hiddenSet.has(t.key)}
                      onChange={() => onToggleTrack?.(t.key)}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <button className="pic" title={focused ? 'Свернуть' : 'Развернуть'} onClick={onToggleFocus}>
          {focused ? <Minimize2 size={14} strokeWidth={1.75} /> : <Maximize2 size={14} strokeWidth={1.75} />}
        </button>
      </div>
      <div
        ref={wrapRef}
        className="plate-canvas-wrap"
        data-plate-id={well.id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!dragRef.current) onCursorDepth(null); }}
      >
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

function drawLithoBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, iv: LithoInterval) {
  roundRect(ctx, x, y, w, h, 3);
  ctx.fillStyle = iv.color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  drawPattern(ctx, x, y, w, h, iv.pattern);
  ctx.restore();
  roundRect(ctx, x, y, w, h, 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawSatBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  roundRect(ctx, x, y, w, h, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawPattern(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: LithoPattern) {
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  if (p === 'diag') {
    for (let i = -h; i < w; i += 5) {
      ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke();
    }
  } else if (p === 'dash') {
    for (let yy = y + 3; yy < y + h; yy += 5) {
      for (let xx = x + 2; xx < x + w; xx += 8) { ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 4, yy); ctx.stroke(); }
    }
  } else if (p === 'brick') {
    for (let yy = y + 4; yy < y + h; yy += 5) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
    let row = 0;
    for (let yy = y; yy < y + h; yy += 5) {
      const off = row % 2 ? w / 2 : 0;
      for (let xx = x + off; xx < x + w; xx += w) { ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + 5); ctx.stroke(); }
      row++;
    }
  } else if (p === 'dots') {
    for (let yy = y + 4; yy < y + h; yy += 6) {
      for (let xx = x + 4; xx < x + w; xx += 6) { ctx.beginPath(); ctx.arc(xx, yy, 1, 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * pow;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0)) return n.toExponential(1);
  return Number(n.toFixed(2)).toString();
}

export { wellDepthExtent };
