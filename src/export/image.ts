import type { Marker } from '../types';
import { DEPTH_AXIS_W, HEADER_H } from '../components/WellLogPlate';
import { RAIL_W } from '../components/CorrelationMarkers';

interface PlateGeom {
  wellId: string;
  name: string;
  canvas: HTMLCanvasElement;
  /** content-space rect (before scale) */
  left: number;
  width: number;
  headerTop: number;
  headerH: number;
  canvasTop: number;
  canvasH: number;
}

/**
 * Compose the on-screen correlation (plate canvases + rail + markers) into a
 * single PNG. Re-measures the DOM so the export matches the current depth
 * window and marker picks; renders at 2× for crisp output.
 */
export function exportCorrelationCanvas(
  bodyEl: HTMLElement,
  markers: Marker[],
  depthWindow: [number, number],
): HTMLCanvasElement | null {
  const corr = bodyEl.querySelector<HTMLElement>('.correlation');
  if (!corr) return null;
  const corrRect = corr.getBoundingClientRect();
  const scrollLeft = corr.scrollLeft;

  const plateEls = Array.from(bodyEl.querySelectorAll<HTMLElement>('.plate'));
  if (plateEls.length === 0) return null;

  const plates: PlateGeom[] = [];
  for (const el of plateEls) {
    const canvas = el.querySelector('canvas');
    const wrap = el.querySelector<HTMLElement>('.plate-canvas-wrap');
    const nameEl = el.querySelector('.pname');
    if (!canvas || !wrap) continue;
    const pr = el.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    plates.push({
      wellId: wrap.dataset.plateId!,
      name: nameEl?.textContent ?? '',
      canvas,
      left: RAIL_W + (pr.left - corrRect.left + scrollLeft),
      width: pr.width,
      headerTop: pr.top - corrRect.top,
      headerH: wr.top - pr.top,
      canvasTop: wr.top - corrRect.top,
      canvasH: wr.height,
    });
  }
  if (plates.length === 0) return null;

  const contentW = Math.ceil(Math.max(...plates.map((p) => p.left + p.width)));
  const contentH = Math.ceil(corrRect.height);
  const S = 2;

  const out = document.createElement('canvas');
  out.width = contentW * S;
  out.height = contentH * S;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.scale(S, S);

  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const canvasBg = v('--canvas', '#13171b');
  const panel2 = v('--panel-2', '#222a31');
  const hairline = v('--plate-grid', 'rgba(151,178,196,0.08)');
  const text = v('--text', '#f4f7fa');
  const text3 = v('--text-3', '#636e83');
  const border = v('--border', 'rgba(151,178,196,0.14)');

  ctx.fillStyle = canvasBg;
  ctx.fillRect(0, 0, contentW, contentH);

  // Plates: header band + composited canvas.
  for (const p of plates) {
    ctx.fillStyle = panel2;
    ctx.fillRect(p.left, p.headerTop, p.width, p.headerH);
    ctx.fillStyle = text;
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.name, p.left + 14, p.headerTop + p.headerH / 2);
    ctx.drawImage(p.canvas, p.left, p.canvasTop, p.width, p.canvasH);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.left + 0.5, p.headerTop + 0.5, p.width - 1, p.headerH + p.canvasH - 1);
  }

  const [top, bottom] = depthWindow;
  const p0 = plates[0];
  const yOf = (p: PlateGeom, depth: number) =>
    p.canvasTop + HEADER_H + ((depth - top) / (bottom - top)) * (p.canvasH - HEADER_H);

  // Rail background + ticks.
  ctx.fillStyle = v('--panel', '#1b2127');
  ctx.fillRect(0, 0, RAIL_W, contentH);
  ctx.strokeStyle = text3;
  ctx.lineWidth = 1;
  const step = niceStep((bottom - top) / 10);
  for (let d = Math.ceil(top / step) * step; d <= bottom; d += step) {
    const y = yOf(p0, d);
    ctx.beginPath();
    ctx.moveTo(RAIL_W - 8, y);
    ctx.lineTo(RAIL_W, y);
    ctx.stroke();
  }

  // Markers: stepped line, handles, rail pill.
  for (const m of markers) {
    const pts: { x0: number; x1: number; y: number }[] = [];
    for (const p of plates) {
      const depth = m.depths[p.wellId];
      if (depth == null || !Number.isFinite(depth)) continue;
      pts.push({ x0: p.left + DEPTH_AXIS_W, x1: p.left + p.width, y: yOf(p, depth) });
    }
    if (pts.length === 0) continue;

    ctx.strokeStyle = m.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(RAIL_W - 14, pts[0].y);
    pts.forEach((pt) => { ctx.lineTo(pt.x0, pt.y); ctx.lineTo(pt.x1, pt.y); });
    ctx.stroke();

    // handles
    ctx.fillStyle = m.color;
    for (const pt of pts) dot(ctx, pt.x0, pt.y, 4, m.color, panel2);
    dot(ctx, RAIL_W - 14, pts[0].y, 5, m.color, panel2);

    // rail pill
    const label = m.label;
    ctx.font = '600 10px ui-monospace, monospace';
    const w = ctx.measureText(label).width + 14;
    const py = pts[0].y + 10;
    roundRect(ctx, 8, py, w, 16, 8);
    ctx.fillStyle = m.color;
    ctx.fill();
    ctx.fillStyle = '#06121b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 15, py + 8);
  }

  void hairline;
  return out;
}

/** Composed correlation as a PNG data URL. */
export function exportCorrelationPng(
  bodyEl: HTMLElement,
  markers: Marker[],
  depthWindow: [number, number],
): string | null {
  return exportCorrelationCanvas(bodyEl, markers, depthWindow)?.toDataURL('image/png') ?? null;
}

/** Composed correlation as a JPEG data URL (for embedding in PDF). */
export function exportCorrelationJpeg(
  bodyEl: HTMLElement,
  markers: Marker[],
  depthWindow: [number, number],
): { dataUrl: string; width: number; height: number } | null {
  const c = exportCorrelationCanvas(bodyEl, markers, depthWindow);
  if (!c) return null;
  return { dataUrl: c.toDataURL('image/jpeg', 0.92), width: c.width, height: c.height };
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const s = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return s * pow;
}
