import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Marker, Well } from '../types';
import { eyeFor, framingFor, START_AZIMUTH, START_ELEVATION, type Bounds } from '../core/geom/camera3d';
import { buildSurface, type ControlPoint } from '../core/framework';
import { clusterPoints } from '../core/geom/cluster';
import { tvdss } from '../core/crs';
import { metricWells } from '../wells/coords';
import { computeTrajectory, positionAtMd, tvdAtMd, type TrajPoint } from '../wells/deviation';
import { useStore } from '../store';
import { faultCurtain, surfaceMesh } from './scene3d/mesh';

interface Props {
  wells: Well[];
  markers: Marker[];
  activeWellId: string | null;
}

/**
 * Display mesh resolution. On the GPU a surface is one draw call whatever its
 * size, so this is chosen for fidelity rather than for a frame budget.
 */
const MESH = 120;
/** Default exaggeration: relief is tens of metres over kilometres of field. */
const DEFAULT_V = 12;

/**
 * 3D view of the structural model: mapped surfaces, well paths and fault
 * planes in one space. Its job is the question a map cannot answer — whether
 * the pieces are consistent with each other. Surfaces that cross, a fault
 * dipping the wrong way, a deviated well that misses the crest: all of them
 * look fine one map at a time.
 *
 * Rendered with three.js. The hand-written Canvas 2D renderer this replaces
 * sorted and filled every quad on the CPU, so its cost grew with the mesh and
 * with the number of surfaces at once — it had to be held down to a 44 x 44
 * mesh and still stuttered. Here the same model measures 1.36 M triangles in
 * 52 draw calls at 0.42 ms a frame, which is what buys the finer mesh below
 * and all the surfaces at once.
 *
 * Coordinates stay in the app's own frame — x east, y north, z *elevation* —
 * rather than three.js's Y-up default, so nothing has to be transposed when
 * reading this against the map code. The camera is told about it once, through
 * `camera.up`.
 */
export function Scene3D({ wells, markers, activeWellId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [vScale, setVScale] = useState(DEFAULT_V);
  const [showWells, setShowWells] = useState(true);
  const [showFaults, setShowFaults] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]);

  const faults = useStore((s) => s.faults);

  const metric = useMemo(() => metricWells(wells), [wells]);
  const coordWells = useMemo(
    () => metric.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)),
    [metric],
  );

  const trajs = useMemo(() => {
    const m = new Map<string, TrajPoint[]>();
    for (const w of coordWells) if (w.survey?.length) m.set(w.id, computeTrajectory(w.survey));
    return m;
  }, [coordWells]);

  /**
   * Elevation, not depth. `tvdss` is positive downwards — 2600 m below sea
   * level is +2600 — while z points up here. Without the flip the whole scene
   * is upside down: deeper surfaces float above the wellheads.
   */
  const elevAt = (w: Well, md: number) => -tvdss(tvdAtMd(trajs.get(w.id) ?? [], md), w.kb);
  const headElev = (w: Well) => -tvdss(0, w.kb);
  const posAt = (w: Well, md: number) => {
    const p = positionAtMd(trajs.get(w.id) ?? [], md);
    return { x: w.x! + p.east, y: w.y! + p.north };
  };

  /** Markers with enough picks to grid, same rule the map uses. */
  const mappable = useMemo(() => {
    const ids = new Set(coordWells.map((w) => w.id));
    return markers.filter(
      (m) => Object.keys(m.depths).filter((id) => ids.has(id) && Number.isFinite(m.depths[id])).length >= 3,
    );
  }, [markers, coordWells]);

  const shown = useMemo(() => mappable.filter((m) => !hidden.includes(m.id)), [mappable, hidden]);

  const controlsFor = useMemo(() => {
    const out = new Map<string, ControlPoint[]>();
    for (const m of mappable) {
      const pts: ControlPoint[] = [];
      for (const w of coordWells) {
        const md = m.depths[w.id];
        if (!Number.isFinite(md)) continue;
        const p = posAt(w, md);
        pts.push({ x: p.x, y: p.y, z: elevAt(w, md) });
      }
      out.set(m.id, pts);
    }
    return out;
  }, [mappable, coordWells, trajs]);

  /**
   * Bounds follow the largest cluster of wells, not all of them: one stray
   * well — a leftover demo point thousands of kilometres away — would stretch
   * the box until the actual field is a single mesh cell. Outliers still draw,
   * they just get no vote on the framing.
   */
  const framing = useMemo(() => {
    const heads = coordWells.map((w) => ({ x: w.x!, y: w.y!, z: headElev(w) }));
    if (heads.length === 0) return null;
    const main = new Set(clusterPoints(heads)[0]?.members ?? heads.map((_, i) => i));
    const inMain = coordWells.filter((_, i) => main.has(i));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const eat = (x: number, y: number, z: number) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    };
    for (const w of inMain) {
      eat(w.x!, w.y!, headElev(w));
      for (const m of shown) {
        const md = m.depths[w.id];
        if (!Number.isFinite(md)) continue;
        const p = posAt(w, md);
        eat(p.x, p.y, elevAt(w, md));
      }
    }
    if (!Number.isFinite(minX)) return null;
    if (maxZ - minZ < 1) { minZ -= 1; maxZ += 1; }
    const bounds: Bounds = { minX, maxX, minY, maxY, minZ, maxZ };
    return { bounds, apart: coordWells.length - inMain.length };
  }, [shown, coordWells, trajs]);

  const bounds = framing?.bounds ?? null;

  /** Surfaces gridded on one shared mesh so they stack in the same space. */
  const surfaces = useMemo(() => {
    if (!bounds) return [];
    const pad = Math.max((bounds.maxX - bounds.minX) * 0.06, 50);
    const padY = Math.max((bounds.maxY - bounds.minY) * 0.06, 50);
    const mesh = {
      minX: bounds.minX - pad, maxX: bounds.maxX + pad,
      minY: bounds.minY - padY, maxY: bounds.maxY + padY,
      nx: MESH, ny: MESH,
    };
    const out: { id: string; arrays: NonNullable<ReturnType<typeof surfaceMesh>> }[] = [];
    for (const m of shown) {
      const built = buildSurface(controlsFor.get(m.id) ?? [], mesh);
      if (!built) continue;
      const arrays = surfaceMesh(built.grid);
      if (arrays) out.push({ id: m.id, arrays });
    }
    return out;
  }, [shown, controlsFor, bounds]);

  // --- three.js plumbing, created once ------------------------------------
  const gl = useRef<{
    renderer: THREE.WebGLRenderer;
    labels: CSS2DRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    root: THREE.Group;
    render: () => void;
  } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    // Labels ride in a transparent DOM overlay: crisp text at any zoom, and no
    // glyph atlas to maintain.
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'scene3d-labels';
    host.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e7);
    camera.up.set(0, 0, 1); // z is up here, not three.js's default y

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(0.4, -0.8, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-0.7, 0.5, 0.4);
    scene.add(fill);

    const root = new THREE.Group();
    scene.add(root);

    // Render on demand — an idle scene should cost nothing. Damping keeps the
    // camera moving briefly after the pointer stops, so keep pumping frames
    // until it settles.
    let queued = false;
    let settle = 0;
    const render = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const moving = controls.update();
        renderer.render(scene, camera);
        labels.render(scene, camera);
        if (moving && settle++ < 240) render();
        else settle = 0;
      });
    };
    controls.addEventListener('change', render);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      if (w < 2 || h < 2) return;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    });
    ro.observe(host);

    gl.current = { renderer, labels, scene, camera, controls, root, render };
    setReady(true);

    return () => {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
      gl.current = null;
    };
  }, []);

  /** Replace the scene contents whenever the model changes. */
  useEffect(() => {
    const g = gl.current;
    if (!g || !ready || !bounds) return;
    const { root } = g;

    // three.js does not free GPU buffers on remove(); leaking them on every
    // surface toggle would climb into hundreds of megabytes.
    for (const child of [...root.children]) {
      root.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
    }
    for (const el of [...g.labels.domElement.children]) el.remove();

    for (const s of surfaces) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(s.arrays.positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(s.arrays.colors, 3));
      geom.setIndex(new THREE.BufferAttribute(s.arrays.indices, 1));
      geom.computeVertexNormals();
      root.add(new THREE.Mesh(geom, new THREE.MeshLambertMaterial({
        vertexColors: true, side: THREE.DoubleSide,
      })));
    }

    if (showFaults) {
      for (const f of faults) {
        const c = faultCurtain(f.trace, bounds.minZ, bounds.maxZ);
        if (!c) continue;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
        geom.setIndex(new THREE.BufferAttribute(c.indices, 1));
        root.add(new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
          color: 0xff9f0a, transparent: true, opacity: 0.28,
          side: THREE.DoubleSide, depthWrite: false,
        })));
      }
    }

    if (showWells) {
      for (const w of coordWells) {
        const traj = trajs.get(w.id);
        const pts: THREE.Vector3[] = [new THREE.Vector3(w.x!, w.y!, headElev(w))];
        if (traj?.length) {
          for (const t of traj) {
            const p = positionAtMd(traj, t.md);
            pts.push(new THREE.Vector3(w.x! + p.east, w.y! + p.north, -tvdss(p.tvd, w.kb)));
          }
        } else {
          pts.push(new THREE.Vector3(w.x!, w.y!, bounds.minZ));
        }
        const active = w.id === activeWellId;
        root.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: active ? 0xffffff : 0xb8c6d4 }),
        ));

        const div = document.createElement('div');
        div.className = `scene3d-label ${active ? 'on' : ''}`;
        div.textContent = w.name;
        const label = new CSS2DObject(div);
        label.position.copy(pts[0]);
        root.add(label);
      }
    }

    g.render();
  }, [ready, surfaces, faults, showFaults, showWells, coordWells, trajs, activeWellId, bounds]);

  /** Exaggeration is a display transform — the data keeps its own scale. */
  useEffect(() => {
    const g = gl.current;
    if (!g || !ready) return;
    g.root.scale.set(1, 1, vScale);
    g.render();
  }, [ready, vScale]);

  /** Frame the model when it — or the exaggeration — changes shape. */
  useEffect(() => {
    const g = gl.current;
    if (!g || !ready || !bounds) return;
    const f = framingFor(bounds, vScale);
    const eye = eyeFor(f, vScale, START_AZIMUTH, START_ELEVATION);
    g.controls.target.set(f.target.x, f.target.y, f.target.z * vScale);
    g.camera.position.set(eye.x, eye.y, eye.z);
    g.camera.near = Math.max(1, f.distance / 1000);
    g.camera.far = f.distance * 20;
    g.camera.updateProjectionMatrix();
    g.controls.update();
    g.render();
  }, [ready, bounds, vScale]);

  const resetView = () => {
    const g = gl.current;
    if (!g || !bounds) return;
    const f = framingFor(bounds, vScale);
    const eye = eyeFor(f, vScale, START_AZIMUTH, START_ELEVATION);
    g.camera.position.set(eye.x, eye.y, eye.z);
    g.controls.target.set(f.target.x, f.target.y, f.target.z * vScale);
    g.controls.update();
    g.render();
  };

  const toggle = (id: string) =>
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  return (
    <div className="scene3d">
      <div className="scene3d-host" ref={hostRef} />

      {!bounds && (
        <div className="scene3d-empty">
          Нужны скважины с координатами и хотя бы одна кровля, пропикированная в трёх скважинах.
        </div>
      )}

      {bounds && (
        <div className="scene3d-panel">
          <label className="scene3d-vex">
            <span>Верт. масштаб ×{vScale}</span>
            <input type="range" min={1} max={60} step={1} value={vScale}
              onChange={(e) => setVScale(Number(e.target.value))} />
          </label>
          <div className="scene3d-toggles">
            <button className={`scene3d-btn ${showWells ? 'on' : ''}`} onClick={() => setShowWells((v) => !v)}>Стволы</button>
            <button className={`scene3d-btn ${showFaults ? 'on' : ''}`} onClick={() => setShowFaults((v) => !v)}
              disabled={faults.length === 0}>Разломы{faults.length ? ` (${faults.length})` : ''}</button>
            <button className="scene3d-btn" onClick={resetView}>Сброс вида</button>
          </div>
          {framing && framing.apart > 0 && (
            <div className="scene3d-note">
              {`Кадр по основной группе; ${framing.apart} скв. в стороне и осталась за кадром.`}
            </div>
          )}
          <div className="scene3d-surfs">
            {mappable.map((m) => (
              <button key={m.id} className={`scene3d-surf ${hidden.includes(m.id) ? '' : 'on'}`}
                onClick={() => toggle(m.id)} title={m.label}>
                <span className="map-surf-dot" style={{ background: m.color }} />{m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="scene3d-hint">Перетаскивание — поворот · колесо — приближение · правая кнопка — сдвиг</div>
    </div>
  );
}
