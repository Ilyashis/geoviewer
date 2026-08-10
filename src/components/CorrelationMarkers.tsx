import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Marker, Well } from '../types';
import { DEPTH_AXIS_W, HEADER_H } from './WellLogPlate';

export const RAIL_W = 76;
const SNAP_PX = 7;

interface Props {
  bodyRef: RefObject<HTMLElement>;
  scrollRef: RefObject<HTMLElement>;
  wells: Well[];
  markers: Marker[];
  selectedMarkerId: string | null;
  depthWindow: [number, number];
  tick: number;
  onDragDepth: (markerId: string, wellId: string, depth: number) => void;
  onSelect: (markerId: string | null) => void;
}

interface Plate { wellId: string; x0: number; x1: number; top: number; h: number }
interface Geom { W: number; H: number; plates: Plate[]; ticks: number[] }

/**
 * Overlay spanning rail + correlation. Draws depth-rail ticks and the
 * interactive correlation markers: stepped lines across wells with draggable
 * per-well handles (snapping to bed boundaries).
 */
export function CorrelationMarkers({
  bodyRef, scrollRef, wells, markers, selectedMarkerId, depthWindow, tick, onDragDepth, onSelect,
}: Props) {
  const [geom, setGeom] = useState<Geom | null>(null);
  const geomRef = useRef<Geom | null>(null);
  const dragRef = useRef<{ markerId: string; wellId: string } | null>(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const measure = () => {
      const br = body.getBoundingClientRect();
      const plates: Plate[] = Array.from(body.querySelectorAll<HTMLElement>('[data-plate-id]')).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          wellId: el.dataset.plateId!,
          x0: r.left - br.left + DEPTH_AXIS_W,
          x1: r.right - br.left,
          top: r.top - br.top + HEADER_H,
          h: r.height - HEADER_H,
        };
      });
      const ticks: number[] = [];
      if (plates.length) {
        const [top, bottom] = depthWindow;
        const p0 = plates[0];
        const step = niceStep((bottom - top) / 10);
        for (let d = Math.ceil(top / step) * step; d <= bottom; d += step) {
          ticks.push(p0.top + ((d - top) / (bottom - top)) * p0.h);
        }
      }
      const g = { W: br.width, H: br.height, plates, ticks };
      geomRef.current = g;
      setGeom(g);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    const scroll = scrollRef.current;
    scroll?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      scroll?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [bodyRef, scrollRef, depthWindow, tick]);

  // --- Dragging a handle ---
  function startDrag(e: React.MouseEvent, markerId: string, wellId: string) {
    e.stopPropagation();
    onSelect(markerId);
    dragRef.current = { markerId, wellId };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  }
  function onDrag(e: MouseEvent) {
    const d = dragRef.current;
    if (!d) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-plate-id="${d.wellId}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const [top, bottom] = depthWindow;
    const plotTop = r.top + HEADER_H;
    const plotH = r.height - HEADER_H;
    const frac = Math.max(0, Math.min(1, (e.clientY - plotTop) / plotH));
    let depth = top + frac * (bottom - top);
    depth = snap(depth, d.wellId, (bottom - top) / plotH);
    onDragDepth(d.markerId, d.wellId, depth);
  }
  function endDrag() {
    dragRef.current = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
  }

  /** Snap to nearest lithology boundary within SNAP_PX. */
  function snap(depth: number, wellId: string, depthPerPx: number): number {
    const well = wells.find((w) => w.id === wellId);
    if (!well) return depth;
    const tol = depthPerPx * SNAP_PX;
    let best = depth;
    let bestDist = tol;
    for (const iv of well.lithology) {
      for (const b of [iv.top, iv.base]) {
        const dist = Math.abs(b - depth);
        if (dist < bestDist) { bestDist = dist; best = b; }
      }
    }
    return best;
  }

  if (!geom || geom.plates.length === 0) return null;
  const [top, bottom] = depthWindow;
  const p0 = geom.plates[0];
  const yOf = (p: Plate, depth: number) => p.top + ((depth - top) / (bottom - top)) * p.h;
  const inView = (y: number) => y > p0.top - 4 && y < p0.top + p0.h + 4;

  return (
    <svg className="corr-overlay" width={geom.W} height={geom.H} viewBox={`0 0 ${geom.W} ${geom.H}`}>
      {geom.ticks.map((y, i) => (
        <line key={`t-${i}`} x1={RAIL_W - 8} y1={y} x2={RAIL_W} y2={y} stroke="var(--text-3)" strokeWidth={1} opacity={0.6} />
      ))}

      {markers.map((m) => {
        const selected = m.id === selectedMarkerId;
        // Only wells that actually have this surface picked; skip the rest.
        const defined = geom.plates.filter((p) => Number.isFinite(m.depths[p.wellId]));
        if (defined.length === 0) return null;
        const refWell = defined[0].wellId;
        const railY = yOf(defined[0], m.depths[refWell]);
        let d = `M ${RAIL_W - 14} ${railY}`;
        defined.forEach((p) => {
          const y = yOf(p, m.depths[p.wellId]);
          d += ` L ${p.x0} ${y} L ${p.x1} ${y}`;
        });
        return (
          <g key={m.id}>
            {/* wide invisible hit line for selection */}
            <path d={d} fill="none" stroke="transparent" strokeWidth={12} className="hit" onMouseDown={() => onSelect(m.id)} />
            <path className="line" d={d} fill="none" stroke={m.color} strokeWidth={selected ? 3 : 2} strokeLinejoin="round" opacity={selected ? 1 : 0.9} />

            {/* per-well drag handles (large transparent hit area + visible dot) */}
            {defined.map((p) => {
              const y = yOf(p, m.depths[p.wellId]);
              if (!inView(y)) return null;
              // A seeded (not yet hand-confirmed) pick draws hollow — filled
              // in the marker colour would read identically to a real pick,
              // and this is exactly the surface where you'd drag it to fix.
              const seeded = m.seeded?.includes(p.wellId);
              return (
                <g key={p.wellId}>
                  <circle className="handle" cx={p.x0} cy={y} r={11} fill="transparent"
                    onMouseDown={(e) => startDrag(e, m.id, p.wellId)} />
                  <circle cx={p.x0} cy={y} r={selected ? 5 : 4}
                    className="dot" fill={seeded ? 'var(--panel)' : m.color}
                    stroke={seeded ? m.color : 'var(--panel)'} strokeWidth={seeded ? 2 : 1.5}>
                    {seeded && <title>Затравка по ближайшей скважине — перетащите, чтобы подтвердить</title>}
                  </circle>
                </g>
              );
            })}

            {/* rail handle + label */}
            {inView(railY) && (
              <>
                <circle className="handle" cx={RAIL_W - 14} cy={railY} r={12} fill="transparent"
                  onMouseDown={(e) => startDrag(e, m.id, refWell)} />
                <circle cx={RAIL_W - 14} cy={railY} r={selected ? 6 : 5}
                  fill={m.color} stroke="var(--panel)" strokeWidth={1.5} pointerEvents="none" />
                <g transform={`translate(8, ${railY + 10})`} className="hit" onMouseDown={() => onSelect(m.id)}>
                  <rect width={m.label.length * 7 + 14} height={16} rx={8} fill={m.color} stroke={selected ? '#fff' : 'none'} strokeWidth={selected ? 1 : 0} />
                  <text x={7} y={11.5} className="corr-pill">{m.label}</text>
                </g>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * pow;
}
