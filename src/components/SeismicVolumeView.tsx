import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { sliceInline, sliceCrossline } from '../seismic/volume';
import { buildSeismicRaster } from '../seismic/raster';

type Axis = 'inline' | 'crossline';
const niceStep = (raw: number) => { const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p; };

/**
 * View-only inline/crossline slicing through an imported 3D SEG-Y volume.
 * Deliberately not folded into `SeismicView`'s picking machinery — v1 is
 * "look at a slice", not "interpret a cube"; a slice's horizon would need
 * cross-slice linking into a real 3D surface to mean anything, and that's a
 * different, much bigger feature than reusing the 2D line's node editor
 * would actually deliver.
 */
export function SeismicVolumeView() {
  const volumes = useStore((s) => s.segyVolumes);
  const removeSegyVolume = useStore((s) => s.removeSegyVolume);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [volumeId, setVolumeId] = useState<string | null>(null);
  const [axis, setAxis] = useState<Axis>('inline');
  const [index, setIndex] = useState(0);

  const volume = volumes.find((v) => v.id === volumeId) ?? volumes[0] ?? null;
  const bound = volume ? (axis === 'inline' ? volume.nInline : volume.nCrossline) : 0;
  const clampedIndex = Math.min(Math.max(index, 0), Math.max(0, bound - 1));

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

  const slice = useMemo(
    () => (volume ? (axis === 'inline' ? sliceInline(volume, clampedIndex) : sliceCrossline(volume, clampedIndex)) : null),
    [volume, axis, clampedIndex],
  );
  const image = useMemo(() => (slice ? buildSeismicRaster(slice) : null), [slice]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !slice || !image) return;
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

    const L = 60, R = 16, T = 20, B = 30;
    const pw = Math.max(10, size.w - L - R), ph = Math.max(10, size.h - T - B);
    if (pw < 20 || ph < 20) return;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, L, T, pw, ph);

    // TWT axis, down the left — same convention as the 2D line view.
    const t0 = slice.t0, tEnd = t0 + slice.dt * (slice.nSamples - 1);
    ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.textAlign = 'right';
    const step = niceStep((tEnd - t0) / 7) || 1;
    for (let t = Math.ceil(t0 / step) * step; t <= tEnd; t += step) {
      const y = T + ((t - t0) / (tEnd - t0 || 1)) * ph;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = text3; ctx.fillText(String(Math.round(t)), L - 8, y + 4);
    }
    ctx.strokeStyle = border; ctx.strokeRect(L, T, pw, ph);
    ctx.textAlign = 'left'; ctx.fillStyle = text2; ctx.fillText('TWT, мс', 4, 14);

    // Trace axis label, along the bottom — the other axis's numbering.
    const otherLabel = axis === 'inline' ? 'Кросслайн' : 'Инлайн';
    ctx.textAlign = 'center'; ctx.fillStyle = text3;
    ctx.fillText(otherLabel, L + pw / 2, size.h - 6);
  }, [slice, image, size, axis]);

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
      <canvas ref={canvasRef} className="seismic-vol-canvas" style={{ width: size.w, height: size.h }} />

      <div className="seismic-panel seismic-vol-panel">
        {volumes.length > 1 && (
          <select className="seismic-vol-select" value={volume?.id ?? ''} onChange={(e) => setVolumeId(e.target.value)}>
            {volumes.map((vol) => <option key={vol.id} value={vol.id}>{vol.label}</option>)}
          </select>
        )}
        <div className="seismic-vol-axis">
          <button className={`seismic-mode-btn ${axis === 'inline' ? 'on' : ''}`} onClick={() => setAxis('inline')}>Инлайн</button>
          <button className={`seismic-mode-btn ${axis === 'crossline' ? 'on' : ''}`} onClick={() => setAxis('crossline')}>Кросслайн</button>
        </div>
        {volume && bound > 0 && (
          <div className="seismic-vol-slider">
            <input type="range" min={0} max={bound - 1} value={clampedIndex}
              onChange={(e) => setIndex(Number(e.target.value))} />
            <span className="mono">
              {axis === 'inline' ? volume.inlineNumbers[clampedIndex] : volume.crosslineNumbers[clampedIndex]}
              {' '}({clampedIndex + 1}/{bound})
            </span>
          </div>
        )}
        {volume && (
          <button className="seismic-remove" onClick={() => removeSegyVolume(volume.id)}>Удалить куб</button>
        )}
      </div>

      {volume && (
        <div className="seismic-vol-info">
          {volume.label} · {volume.nInline}×{volume.nCrossline} трасс · {volume.nSamples} отсч.
        </div>
      )}
    </div>
  );
}
