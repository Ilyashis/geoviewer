import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useStore } from '../store';
import { sliceInline, sliceCrossline, sliceTime } from '../seismic/volume';
import { buildSeismicRaster, buildTimeSliceRaster } from '../seismic/raster';
import { trackHorizon3D, surfaceProfile, surfaceStats, surfaceControls, controlStepFor, type HorizonSurface } from '../seismic/track3d';
import { DEFAULT_VELOCITY, twtToDepth } from '../core/velocity';
import { fitSimilarity } from '../core/geom/similarity';

type Axis = 'inline' | 'crossline' | 'time';
const niceStep = (raw: number) => { const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p; };
/** Evenly-spaced index ticks (not by real inline/crossline number spacing,
 * which need not be regular) — same idea as niceStep, just over an index
 * range instead of a continuous one. */
const tickIndices = (n: number, want = 6): number[] => {
  if (n <= 1) return [0];
  const step = Math.max(1, Math.round(n / want));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
};

/** Plot frame shared by draw and hit-testing — they must agree exactly. */
const FRAME = { L: 60, R: 16, T: 20, B: 30 };

/** A cube has no well tops to name a horizon after, so picks get numbered
 * and coloured from a fixed palette; the colour is what the map keeps. */
const HORIZON_COLORS = ['#f2c14e', '#7fd1ae', '#e07a5f', '#8ab4f8', '#c792ea', '#f78c6c', '#89ddff', '#ffcb6b'];

/** One tracked horizon in this cube. Session-local: what's persisted is
 * its control-point form in `seismicHorizons`, same as a line's pick. */
interface VolHorizon { label: string; color: string; surface: HorizonSurface | null }

/**
 * Inline/crossline/time slicing through an imported 3D SEG-Y volume, plus
 * seeded horizon tracking through it: click a slice to plant a seed, the
 * pick grows across the whole cube (`trackHorizon3D`) and shows up on every
 * slice it crosses — as a line on a vertical section, as the set of bins it
 * passes through on a time slice. Deliberately not the 2D line's node
 * editor: a surface has no "nodes along the trace" to drag; steering it is
 * re-seeding or narrowing the window, which is what OpendTect's and Petrel's
 * volume trackers expose too.
 */
export function SeismicVolumeView() {
  const volumes = useStore((s) => s.segyVolumes);
  const removeSegyVolume = useStore((s) => s.removeSegyVolume);
  const seismicHorizons = useStore((s) => s.seismicHorizons);
  const markers = useStore((s) => s.markers);
  const setSeismicHorizon = useStore((s) => s.setSeismicHorizon);
  const clearSeismicHorizon = useStore((s) => s.clearSeismicHorizon);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [volumeId, setVolumeId] = useState<string | null>(null);
  const [axis, setAxis] = useState<Axis>('inline');
  const [index, setIndex] = useState(0);
  // Keyed by volume: a surface is a grid of THIS cube's bins and means
  // nothing on another one, but switching cubes mustn't throw it away.
  const [horizonsByVolume, setHorizonsByVolume] = useState<Record<string, VolHorizon[]>>({});
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [windowMs, setWindowMs] = useState(26);
  // Amplitude floor, % of the cube's max. Not 0: with no floor, a +noise
  // sample counts as "a positive peak", and one such step is enough to
  // bring a reflector that's really outside the window (a fault throw)
  // back inside it — the flood-fill then crosses the fault through the
  // noise (track3d.test.ts pins this down). 10% is above the noise of a
  // reasonable stack and well below any reflector worth picking.
  const [minAmpPct, setMinAmpPct] = useState(10);
  const [seedNote, setSeedNote] = useState<string | null>(null);

  const volume = volumes.find((v) => v.id === volumeId) ?? volumes[0] ?? null;
  const bound = volume ? (axis === 'inline' ? volume.nInline : axis === 'crossline' ? volume.nCrossline : volume.nSamples) : 0;
  const clampedIndex = Math.min(Math.max(index, 0), Math.max(0, bound - 1));
  const horizons = volume ? horizonsByVolume[volume.id] ?? [] : [];
  const active = horizons.find((h) => h.label === activeLabel) ?? horizons[0] ?? null;
  const setHorizons = (fn: (prev: VolHorizon[]) => VolHorizon[]) => {
    if (!volume) return;
    setHorizonsByVolume((prev) => ({ ...prev, [volume.id]: fn(prev[volume.id] ?? []) }));
  };

  // A different volume or axis makes the current index meaningless — back to the middle.
  useEffect(() => { setIndex(Math.floor(bound / 2)); }, [volume?.id, axis]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Two different shapes, not one: inline/crossline are vertical sections
  // (trace × sample, same as a 2D line); a time slice is an areal map with
  // no sample axis left, so it needs its own raster builder and axis code.
  const verticalSlice = useMemo(
    () => (volume && axis !== 'time' ? (axis === 'inline' ? sliceInline(volume, clampedIndex) : sliceCrossline(volume, clampedIndex)) : null),
    [volume, axis, clampedIndex],
  );
  const timeSlice = useMemo(
    () => (volume && axis === 'time' ? sliceTime(volume, clampedIndex) : null),
    [volume, axis, clampedIndex],
  );
  const image = useMemo(
    () => (verticalSlice ? buildSeismicRaster(verticalSlice) : timeSlice ? buildTimeSliceRaster(timeSlice) : null),
    [verticalSlice, timeSlice],
  );

  const plot = useMemo(() => {
    const { L, R, T, B } = FRAME;
    const pw = Math.max(10, size.w - L - R), ph = Math.max(10, size.h - T - B);
    return { L, T, pw, ph, ok: pw >= 20 && ph >= 20 };
  }, [size]);

  /** Depth conversion for a cube: the constant default, the same starting
   * point a line gets before calibration. There are no well tops posted
   * on a cube slice to calibrate against yet — said in the panel, not hidden. */
  const conv = DEFAULT_VELOCITY;
  const xform = useMemo(() => (volume?.tie ? fitSimilarity(volume.tie[0], volume.tie[1]) : null), [volume]);

  const stats = useMemo(() => (active?.surface ? surfaceStats(active.surface) : null), [active]);
  const controls = useMemo(() => {
    if (!volume || !active?.surface || !stats || stats.tracked === 0) return null;
    return surfaceControls(volume, active.surface, conv, controlStepFor(stats.tracked), xform);
  }, [volume, active, stats, conv, xform]);
  const inMap = !!(volume && active && seismicHorizons[active.label]?.[volume.id]);

  const newHorizon = () => {
    let n = horizons.length + 1;
    while (horizons.some((h) => h.label === `Горизонт ${n}`)) n++;
    const label = `Горизонт ${n}`;
    setHorizons((prev) => [...prev, { label, color: HORIZON_COLORS[prev.length % HORIZON_COLORS.length], surface: null }]);
    setActiveLabel(label);
    setSeedNote(null);
  };
  const removeHorizon = (label: string) => {
    setHorizons((prev) => prev.filter((h) => h.label !== label));
    if (activeLabel === label) setActiveLabel(null);
  };
  /** The label is what joins a cube pick to the rest of the project: name
   * it after a well top and the map merges it into that top's structure
   * surface, like a line pick. Locked once saved — the store is keyed by
   * it, and renaming a saved one would orphan the saved entry. */
  const renameHorizon = (from: string, to: string) => {
    const next = to.trim();
    if (!next || next === from || horizons.some((h) => h.label === next)) return;
    const marker = markers.find((m) => m.label === next);
    setHorizons((prev) => prev.map((h) => (h.label === from ? { ...h, label: next, color: marker?.color ?? h.color } : h)));
    setActiveLabel(next);
  };

  /** Pixel → (il, xl, twt) on whichever slice is showing; null off-plot. */
  const seedAt = (mx: number, my: number) => {
    if (!volume || !plot.ok) return null;
    const fx = (mx - plot.L) / plot.pw, fy = (my - plot.T) / plot.ph;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    if (timeSlice) {
      return { il: Math.round(fy * (timeSlice.nInline - 1)), xl: Math.round(fx * (timeSlice.nCrossline - 1)), twt: timeSlice.twt };
    }
    if (!verticalSlice) return null;
    const trace = Math.round(fx * (verticalSlice.nTraces - 1));
    const tEnd = verticalSlice.t0 + verticalSlice.dt * (verticalSlice.nSamples - 1);
    const twt = verticalSlice.t0 + fy * (tEnd - verticalSlice.t0);
    return axis === 'inline' ? { il: clampedIndex, xl: trace, twt } : { il: trace, xl: clampedIndex, twt };
  };

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!volume) return;
    const r = e.currentTarget.getBoundingClientRect();
    const seed = seedAt(e.clientX - r.left, e.clientY - r.top);
    if (!seed) return;
    // First click with nothing to pick into starts a horizon; re-seeding an
    // existing one replaces its surface — the seed IS the pick's whole
    // input, so there's no hand-edited state to lose.
    let label = active?.label ?? null;
    if (!label) {
      label = 'Горизонт 1';
      setHorizons((prev) => [...prev, { label: label!, color: HORIZON_COLORS[0], surface: null }]);
      setActiveLabel(label);
    }
    const surface = trackHorizon3D(volume, seed, { windowMs, minAmp: minAmpPct / 100 });
    const st = surfaceStats(surface);
    setSeedNote(st.tracked === 0 ? 'Под семенем нет пика выше порога в окне — трекер ничего не снял. Кликните ближе к красному отражению, расширьте окно или снизьте порог.' : null);
    setHorizons((prev) => prev.map((h) => (h.label === label ? { ...h, surface } : h)));
  };

  const saveToMap = () => {
    if (!volume || !active || !controls) return;
    setSeismicHorizon(active.label, volume.id, controls);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !volume) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr; canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const text2 = v('--text-2', '#a7b4c4'), text3 = v('--text-3', '#636e83'), border = v('--border', 'rgba(151,178,196,0.16)');
    ctx.font = '11px ui-monospace, monospace';

    const { L, T, pw, ph, ok } = plot;
    if (!ok) return;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, L, T, pw, ph);

    // Horizon legend, bottom-right — the corner nothing else claims (panel
    // top-left, results aside top-right, cube info bottom-left).
    const drawLegend = () => {
      const withPick = horizons.filter((h) => h.surface);
      if (withPick.length === 0) return;
      ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left';
      withPick.forEach((h, k) => {
        const ry = T + ph - 8 - (withPick.length - 1 - k) * 14;
        ctx.fillStyle = h.color; ctx.fillRect(L + pw - 100, ry - 7, 9, 9);
        ctx.fillStyle = h.label === active?.label ? text2 : text3;
        ctx.fillText(h.label, L + pw - 87, ry);
      });
      ctx.font = '11px ui-monospace, monospace';
    };

    if (timeSlice) {
      // Areal map: inline down the left, crossline along the bottom, both by
      // real header number — and the one TWT this whole map sits at, as a
      // readout rather than an axis (there's nothing to tick along it).
      ctx.strokeStyle = border; ctx.lineWidth = 1;
      ctx.textAlign = 'right';
      for (const i of tickIndices(timeSlice.nInline)) {
        const y = T + (i / Math.max(1, timeSlice.nInline - 1)) * ph;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
        ctx.fillStyle = text3; ctx.fillText(String(volume.inlineNumbers[i]), L - 8, y + 4);
      }
      ctx.textAlign = 'center';
      for (const i of tickIndices(timeSlice.nCrossline)) {
        const x = L + (i / Math.max(1, timeSlice.nCrossline - 1)) * pw;
        ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
        ctx.fillStyle = text3; ctx.fillText(String(volume.crosslineNumbers[i]), x, T + ph + 16);
      }
      // Where each tracked surface passes through this time: the bins
      // within half a sample of the slice's TWT, as an areal outline.
      const cw = pw / timeSlice.nCrossline, ch = ph / timeSlice.nInline;
      const half = volume.dt / 2 + 1e-6;
      for (const h of horizons) {
        if (!h.surface) continue;
        ctx.fillStyle = h.color; ctx.globalAlpha = h.label === active?.label ? 0.9 : 0.5;
        const { nInline, nCrossline, twt } = h.surface;
        for (let il = 0; il < nInline; il++) for (let xl = 0; xl < nCrossline; xl++) {
          const t = twt[il * nCrossline + xl];
          if (Number.isNaN(t) || Math.abs(t - timeSlice.twt) > half) continue;
          ctx.fillRect(L + xl * cw, T + il * ch, Math.max(1, cw), Math.max(1, ch));
        }
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = border; ctx.strokeRect(L, T, pw, ph);
      ctx.textAlign = 'left'; ctx.fillStyle = text2; ctx.fillText('Инлайн', 4, 14);
      ctx.textAlign = 'center'; ctx.fillStyle = text3; ctx.fillText('Кросслайн', L + pw / 2, size.h - 6);
      ctx.textAlign = 'right'; ctx.fillStyle = text2;
      ctx.fillText(`TWT: ${Math.round(timeSlice.twt)} мс`, L + pw, 14);
      drawLegend();
      return;
    }

    if (!verticalSlice) return;
    // TWT axis, down the left — same convention as the 2D line view.
    const t0 = verticalSlice.t0, tEnd = t0 + verticalSlice.dt * (verticalSlice.nSamples - 1);
    const yOf = (t: number) => T + ((t - t0) / (tEnd - t0 || 1)) * ph;
    const xOf = (i: number) => L + (i / Math.max(1, verticalSlice.nTraces - 1)) * pw;
    ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.textAlign = 'right';
    const step = niceStep((tEnd - t0) / 7) || 1;
    for (let t = Math.ceil(t0 / step) * step; t <= tEnd; t += step) {
      const y = yOf(t);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = text3; ctx.fillText(String(Math.round(t)), L - 8, y + 4);
    }

    // Each tracked surface's trace along this slice; gaps where it never
    // reached. Active one bright, the rest muted — same convention the 2D
    // line uses for its saved-horizon references.
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    for (const h of horizons) {
      if (!h.surface) continue;
      const prof = surfaceProfile(h.surface, axis === 'inline' ? 'inline' : 'crossline', clampedIndex);
      const isActive = h.label === active?.label;
      ctx.strokeStyle = h.color; ctx.lineWidth = isActive ? 2 : 1.5; ctx.globalAlpha = isActive ? 1 : 0.55;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < prof.length; i++) {
        const t = prof[i];
        if (Number.isNaN(t)) { pen = false; continue; }
        if (pen) ctx.lineTo(xOf(i), yOf(t)); else ctx.moveTo(xOf(i), yOf(t));
        pen = true;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // The seed, when it sits on this very slice.
      const s = h.surface.seed;
      const onSlice = axis === 'inline' ? s.il === clampedIndex : s.xl === clampedIndex;
      if (onSlice && isActive) {
        const bin = s.il * h.surface.nCrossline + s.xl;
        const t = h.surface.twt[bin];
        if (!Number.isNaN(t)) {
          ctx.fillStyle = h.color; ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(xOf(axis === 'inline' ? s.xl : s.il), yOf(t), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
    }
    ctx.restore();

    ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
    ctx.textAlign = 'left'; ctx.fillStyle = text2; ctx.fillText('TWT, мс', 4, 14);

    // Trace axis label, along the bottom — the other axis's numbering.
    const otherLabel = axis === 'inline' ? 'Кросслайн' : 'Инлайн';
    ctx.textAlign = 'center'; ctx.fillStyle = text3;
    ctx.fillText(otherLabel, L + pw / 2, size.h - 6);
    drawLegend();
  }, [verticalSlice, timeSlice, image, size, axis, volume, plot, horizons, active, clampedIndex]);

  if (volumes.length === 0) {
    return (
      <div className="placeholder">
        <div className="pc">
          <h3>Куб</h3>
          <p>Импортируйте 3D SEG-Y (файл с более чем одним инлайном и одним кросслайном) — он распознаётся как куб автоматически, отдельно от 2D-линий.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="seismic-vol" ref={wrapRef}>
      <canvas ref={canvasRef} className="seismic-vol-canvas" style={{ width: size.w, height: size.h, cursor: 'crosshair' }} onClick={onClick} />

      <div className="seismic-panel seismic-vol-panel">
        {volumes.length > 1 && (
          <select className="seismic-vol-select" value={volume?.id ?? ''} onChange={(e) => setVolumeId(e.target.value)}>
            {volumes.map((vol) => <option key={vol.id} value={vol.id}>{vol.label}</option>)}
          </select>
        )}
        <div className="seismic-vol-axis">
          <button className={`seismic-mode-btn ${axis === 'inline' ? 'on' : ''}`} onClick={() => setAxis('inline')}>Инлайн</button>
          <button className={`seismic-mode-btn ${axis === 'crossline' ? 'on' : ''}`} onClick={() => setAxis('crossline')}>Кросслайн</button>
          <button className={`seismic-mode-btn ${axis === 'time' ? 'on' : ''}`} onClick={() => setAxis('time')}>Тайм-слайс</button>
        </div>
        {volume && bound > 0 && (
          <div className="seismic-vol-slider">
            <input type="range" min={0} max={bound - 1} value={clampedIndex}
              onChange={(e) => setIndex(Number(e.target.value))} />
            <span className="mono">
              {axis === 'inline' ? volume.inlineNumbers[clampedIndex]
                : axis === 'crossline' ? volume.crosslineNumbers[clampedIndex]
                : `${Math.round(volume.t0 + clampedIndex * volume.dt)} мс`}
              {' '}({clampedIndex + 1}/{bound})
            </span>
          </div>
        )}

        <div>
          <div className="seismic-panel-h seismic-panel-h2">Снять горизонт</div>
          <div className="seismic-picks">
            {horizons.map((h) => (
              <button key={h.label} className={`seismic-pick ${h.label === active?.label ? 'on' : ''}`}
                onClick={() => { setActiveLabel(h.label); setSeedNote(null); }} title={h.surface ? 'Клик по срезу — пересадить семя' : 'Кликните по срезу, чтобы посадить семя'}>
                <span className="seismic-dot" style={{ background: h.color }} />{h.label}
                {!h.surface && <span className="seismic-vol-unpicked">· нет семени</span>}
              </button>
            ))}
            <button className="seismic-pick seismic-vol-new" onClick={newHorizon}>+ новый</button>
          </div>
          <label className="seismic-vol-window">
            <span>Окно поиска</span>
            <input type="range" min={8} max={80} step={2} value={windowMs} onChange={(e) => setWindowMs(Number(e.target.value))} />
            <b className="mono">±{windowMs} мс</b>
          </label>
          <label className="seismic-vol-window" title="Пик слабее этой доли от максимума куба не считается отражением — иначе трекер расползается по шуму и проходит сквозь разломы">
            <span>Порог амплитуды</span>
            <input type="range" min={0} max={50} step={1} value={minAmpPct} onChange={(e) => setMinAmpPct(Number(e.target.value))} />
            <b className="mono">{minAmpPct}%</b>
          </label>
          <div className="seismic-hint">
            Клик по любому срезу сажает семя; пик отслеживается по всему кубу и виден на каждом срезе, который пересекает.
            Оторвался не туда — пересадите семя, сузьте окно или поднимите порог; не дошёл до края — наоборот.
          </div>
          {seedNote && <div className="seismic-vol-warn">{seedNote}</div>}
        </div>

        {volume && (
          <button className="seismic-remove" onClick={() => removeSegyVolume(volume.id)}>Удалить куб</button>
        )}
      </div>

      {volume && active?.surface && stats && (
        <aside className="seismic-result">
          <div className="seismic-result-h"><span className="seismic-dot" style={{ background: active.color }} />{active.label} · {volume.label}</div>
          <label className="seismic-vol-label" title={inMap ? 'Горизонт уже в карте — чтобы переименовать, сначала уберите его из карты' : 'Назовите как пласт скважины — и на карте он сольётся с его поверхностью'}>
            <span>Пласт</span>
            <input list="seismic-vol-tops" value={active.label} disabled={inMap}
              onChange={(e) => renameHorizon(active.label, e.target.value)} />
            <datalist id="seismic-vol-tops">{markers.map((m) => <option key={m.id} value={m.label} />)}</datalist>
          </label>
          <div className="seismic-row"><span>Покрытие</span><b>{(100 * stats.tracked / stats.total).toFixed(stats.tracked / stats.total < 0.1 ? 1 : 0)}% ({stats.tracked} из {stats.total} бинов)</b></div>
          <div className="seismic-row"><span>Семя</span><b>IL {volume.inlineNumbers[active.surface.seed.il]} · XL {volume.crosslineNumbers[active.surface.seed.xl]}</b></div>
          {stats.tracked > 0 && (
            <>
              <div className="seismic-row"><span>TWT</span><b>{Math.round(stats.twtMin)}–{Math.round(stats.twtMax)} мс</b></div>
              <div className="seismic-row"><span>Глубина</span><b>{Math.round(twtToDepth(conv, stats.twtMin))}–{Math.round(twtToDepth(conv, stats.twtMax))} м</b></div>
              <div className="seismic-row"><span>→ buildSurface</span><b>{controls?.length ?? 0} точек</b></div>
              <div className="seismic-note">
                Глубина — по постоянной v = {conv.kind === 'const' ? conv.v : 2200} м/с: калибровки по кровлям для куба пока нет.
                Координаты бинов — {xform ? 'через привязку по опорным точкам' : 'как записаны в файле, без привязки'}.
              </div>
              <button className="seismic-apply" onClick={saveToMap}>
                {inMap ? 'Обновить в карте' : 'Использовать в карте'}
              </button>
              {inMap && <button className="seismic-remove" onClick={() => clearSeismicHorizon(active.label, volume.id)}>убрать из карты</button>}
            </>
          )}
          <button className="seismic-remove" onClick={() => removeHorizon(active.label)}>удалить горизонт</button>
        </aside>
      )}

      {volume && (
        <div className="seismic-vol-info">
          {volume.label} · {volume.nInline}×{volume.nCrossline} трасс · {volume.nSamples} отсч.
        </div>
      )}
    </div>
  );
}
