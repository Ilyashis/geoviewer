import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers, Share2, FolderOpen, MessageSquare,
  MousePointer2, Square, PenLine, Milestone, Type, Table as TableIcon,
  Navigation, Spline, Upload, Database, Radio,
} from 'lucide-react';
import { useStore } from './store';
import { Logo } from './components/Logo';
import { WellLogPlate, wellDepthExtent } from './components/WellLogPlate';
import { CorrelationMarkers, RAIL_W } from './components/CorrelationMarkers';
import { MarkerInspector } from './components/MarkerInspector';
import { ImportModal } from './components/ImportModal';
import { ExportMenu } from './components/ExportMenu';
import { ProjectMenu } from './components/ProjectMenu';
import { Dashboard } from './components/Dashboard';
import { WellMap, type WellMapHandle } from './components/WellMap';
import { WellTie } from './components/WellTie';
import { ReservesSummary } from './components/ReservesSummary';
import { CrossplotView, type CrossplotHandle } from './components/CrossplotView';
import { SeismicView } from './components/SeismicView';
import { CrossSectionView, type CrossSectionHandle } from './components/CrossSectionView';
import { DataPanel } from './components/DataPanel';
import { useConfirm } from './hooks/useConfirm';

import {
  bootstrap, persist, createProject, renameProject, switchProject, deleteProject,
} from './persistence';
import { buildDemoLas } from './sampleData';

/**
 * three.js weighs ~136 kB gzipped — more than the entire rest of the app. It is
 * fetched when the 3D tab is first opened, so loading a project and reading a
 * map never pays for a renderer the user may not touch.
 */
const Scene3D = lazy(() => import('./components/Scene3D').then((m) => ({ default: m.Scene3D })));

type TabKey = 'map' | 'correlation' | 'tie' | 'seismic' | 'scene3d' | 'section' | 'crossplot' | 'reserves' | 'dashboard';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'map', label: 'Карта' },
  { key: 'correlation', label: 'Корр. схема' },
  { key: 'tie', label: 'Привязка' },
  { key: 'seismic', label: 'Сейсмика' },
  { key: 'scene3d', label: '3D' },
  { key: 'section', label: 'Разрез' },
  { key: 'crossplot', label: 'Кроссплоты' },
  { key: 'reserves', label: 'Запасы' },
  { key: 'dashboard', label: 'Дашборд' },
];

const TOOLS = [
  { key: 'select', label: 'Выделение', Icon: MousePointer2 },
  { key: 'lithology', label: 'Литология', Icon: Square },
  { key: 'line', label: 'Линия', Icon: PenLine },
  { key: 'marker', label: 'Маркер', Icon: Milestone },
  { key: 'text', label: 'Текст', Icon: Type },
  { key: 'table', label: 'Таблица', Icon: TableIcon },
] as const;

// Correlation has its own dynamic, tool-dependent hint below — everything
// else gets one static line describing its actual (verified) interaction.
// Tabs with no canvas/pointer interaction of their own (section, crossplot,
// reserves, dashboard), or that already show their own in-canvas hint
// (scene3d has .scene3d-hint), are left out rather than given a duplicate
// or made-up hint.
const TAB_HINTS: Partial<Record<TabKey, string>> = {
  map: 'Колесо — зум · перетаскивание — панорама · клик по скважине — сделать активной',
  tie: 'Клик по ячейке — ввести или изменить глубину пикировки',
  seismic: 'Клик по линии — пикировка горизонта · перетаскивание точки — правка',
  section: 'Колесо — зум · перетаскивание — панорама',
  crossplot: 'Колесо — зум · перетаскивание — панорама (только для кроссплота, не гистограммы)',
};

export default function App() {
  const wells = useStore((s) => s.wells);
  const markers = useStore((s) => s.markers);
  const error = useStore((s) => s.error);
  const activeWellId = useStore((s) => s.activeWellId);
  const selectedMarkerId = useStore((s) => s.selectedMarkerId);
  const addLasFiles = useStore((s) => s.addLasFiles);
  const loadLasText = useStore((s) => s.loadLasText);
  const loadDemoField = useStore((s) => s.loadDemoField);
  const removeWell = useStore((s) => s.removeWell);
  const setActiveWell = useStore((s) => s.setActiveWell);
  const addMarkerAtDepth = useStore((s) => s.addMarkerAtDepth);
  const updateMarkerDepth = useStore((s) => s.updateMarkerDepth);
  const removeMarkerDepth = useStore((s) => s.removeMarkerDepth);
  const renameMarker = useStore((s) => s.renameMarker);
  const removeMarker = useStore((s) => s.removeMarker);
  const selectMarker = useStore((s) => s.selectMarker);
  const replaceProject = useStore((s) => s.replaceProject);
  const clearAll = useStore((s) => s.clearAll);
  const projectId = useStore((s) => s.projectId);
  const projectName = useStore((s) => s.projectName);
  const projects = useStore((s) => s.projects);
  const setProjects = useStore((s) => s.setProjects);
  const setCurrentProject = useStore((s) => s.setCurrentProject);
  const hiddenTracks = useStore((s) => s.hiddenTracks);
  const toggleTrack = useStore((s) => s.toggleTrack);
  const setFocusRequest = useStore((s) => s.setFocusRequest);
  const selectedMarker = markers.find((m) => m.id === selectedMarkerId) ?? null;
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [tab, setTab] = useState<TabKey>('correlation');
  const [tool, setTool] = useState<string>('select');
  const [showImport, setShowImport] = useState(false);
  const [depthWindow, setDepthWindow] = useState<[number, number] | null>(null);
  const [cursorDepth, setCursorDepth] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dataPanelOpen, setDataPanelOpen] = useState(false);
  const { confirm: confirmDestroy, dialog: destroyDialog } = useConfirm();
  const [focusedWellId, setFocusedWellId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const segyInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<WellMapHandle>(null);
  const sectionRef = useRef<CrossSectionHandle>(null);
  const crossplotRef = useRef<CrossplotHandle>(null);
  const [mapZoomPct, setMapZoomPct] = useState<number | null>(null);
  const [sectionZoomPct, setSectionZoomPct] = useState<number | null>(null);
  const [crossplotZoomPct, setCrossplotZoomPct] = useState<number | null>(null);

  useEffect(() => {
    if (wells.length === 0) { setDepthWindow(null); return; }
    if (depthWindow) return;
    let top = Infinity, bottom = -Infinity;
    for (const w of wells) {
      const [mn, mx] = wellDepthExtent(w);
      top = Math.min(top, mn); bottom = Math.max(bottom, mx);
    }
    if (Number.isFinite(top) && Number.isFinite(bottom)) setDepthWindow([top, bottom]);
  }, [wells, depthWindow]);

  // Bootstrap the active project on mount, then persist changes to it (debounced).
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    bootstrap().then((b) => {
      if (cancelled) return;
      replaceProject(b.data);
      setCurrentProject(b.activeId, b.name);
      setProjects(b.list);
      setSavedAt(b.list.find((p) => p.id === b.activeId)?.updatedAt ?? null);

      // Track data-slice identity so unrelated state changes (selection, project
      // list) don't trigger a save — and the initial hydration above never does.
      const g = useStore.getState();
      let last = {
        wells: g.wells, markers: g.markers, activeWellId: g.activeWellId, hiddenTracks: g.hiddenTracks,
        faults: g.faults, sections: g.sections, checkshots: g.checkshots, segyLines: g.segyLines, seismicHorizons: g.seismicHorizons,
      };
      unsub = useStore.subscribe((s) => {
        if (
          s.wells === last.wells && s.markers === last.markers && s.activeWellId === last.activeWellId && s.hiddenTracks === last.hiddenTracks &&
          s.faults === last.faults && s.sections === last.sections && s.checkshots === last.checkshots && s.segyLines === last.segyLines && s.seismicHorizons === last.seismicHorizons
        ) return;
        last = {
          wells: s.wells, markers: s.markers, activeWellId: s.activeWellId, hiddenTracks: s.hiddenTracks,
          faults: s.faults, sections: s.sections, checkshots: s.checkshots, segyLines: s.segyLines, seismicHorizons: s.seismicHorizons,
        };
        clearTimeout(timer);
        timer = setTimeout(() => {
          const st = useStore.getState();
          if (!st.projectId) return;
          persist(st.projectId, st.projectName, {
            wells: st.wells, markers: st.markers, activeWellId: st.activeWellId, hiddenTracks: st.hiddenTracks,
            faults: st.faults, sections: st.sections, checkshots: st.checkshots, segyLines: st.segyLines, seismicHorizons: st.seismicHorizons,
          })
            .then((list) => { setProjects(list); setSavedAt(Date.now()); })
            .catch(() => {});
        }, 500);
      });
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsub?.();
    };
  }, [replaceProject, setCurrentProject, setProjects]);

  // Keyboard shortcuts for the selected marker (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const id = st.selectedMarkerId;
      if (!id) return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'Escape') { st.selectMarker(null); e.preventDefault(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const marker = st.markers.find((m) => m.id === id);
        confirmDestroy({
          title: `Удалить разбивку «${marker?.label ?? ''}»?`,
          message: 'Пикировки по всем скважинам для этой разбивки будут удалены без возможности восстановления.',
          onConfirm: () => st.removeMarker(id),
        });
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const wellId = st.activeWellId;
        const marker = st.markers.find((m) => m.id === id);
        const cur = wellId ? marker?.depths[wellId] : undefined;
        if (wellId == null || cur == null) return;
        const step = (e.shiftKey ? 5 : 0.5) * (e.key === 'ArrowUp' ? -1 : 1);
        st.updateMarkerDepth(id, wellId, Number((cur + step).toFixed(2)));
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmDestroy]);

  // --- Project management ---
  const onSwitchProject = async (id: string) => {
    const { name, list, data } = await switchProject(id);
    setCurrentProject(id, name);
    setProjects(list);
    replaceProject(data);
    setDepthWindow(null);
  };
  const onCreateProject = async () => {
    const { id, list, data } = await createProject('Новый проект');
    setProjects(list);
    setCurrentProject(id, 'Новый проект');
    replaceProject(data);
    setDepthWindow(null);
  };
  const onRenameProject = async (id: string, name: string) => {
    setProjects(await renameProject(id, name));
    if (id === projectId) setCurrentProject(id, name);
  };
  const onDeleteProject = async (id: string) => {
    const b = await deleteProject(id);
    setProjects(b.list);
    setCurrentProject(b.activeId, b.name);
    replaceProject(b.data);
    setDepthWindow(null);
  };

  const effectiveWindow = useMemo<[number, number]>(() => depthWindow ?? [0, 100], [depthWindow]);
  const showCorrelation = tab === 'correlation' && wells.length > 0;
  // When a well is focused, only that plate is shown (fullscreen).
  const displayedWells = focusedWellId
    ? wells.filter((w) => w.id === focusedWellId)
    : wells;
  const savedLabel = savedAt
    ? `Сохранено ${new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo"><Logo size={18} /></div>
        </div>
        <ProjectMenu
          name={projectName}
          projects={projects}
          currentId={projectId}
          onSwitch={onSwitchProject}
          onCreate={onCreateProject}
          onRename={onRenameProject}
          onDelete={onDeleteProject}
        />

        <nav className="tabs">
          {TABS.map(({ key, label }) => (
            <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="right">
          <button className="iconbtn" title="Открыть LAS / SEG-Y" onClick={() => inputRef.current?.click()}>
            <FolderOpen size={16} strokeWidth={1.75} />
          </button>
          <button className="iconbtn" title="Импорт из CSV: разбивки, литология, инклинометрия, устья" onClick={() => setShowImport(true)}>
            <Milestone size={16} strokeWidth={1.75} />
          </button>
          <ExportMenu bodyRef={bodyRef} depthWindow={effectiveWindow} />
          <button className={`iconbtn ${dataPanelOpen ? 'on' : ''}`} title="Данные проекта" onClick={() => setDataPanelOpen((o) => !o)}>
            <Database size={16} strokeWidth={1.75} />
          </button>
          <button className="btn ghost sm" title="Добавить демо-скважину"
            onClick={() => loadLasText(buildDemoLas(wells.length), 'andromeda-demo.las')}>
            Демо
          </button>
          {wells.length > 0 && (
            <button className="btn ghost sm" title="Очистить проект" onClick={() => confirmDestroy({
              title: 'Очистить проект?',
              message: `Все скважины, разбивки, разломы, разрезы и импортированные данные проекта «${projectName}» будут удалены без возможности восстановления.`,
              onConfirm: () => clearAll(),
            })}>
              Очистить
            </button>
          )}
          <button className="iconbtn" title="Поделиться"><Share2 size={16} strokeWidth={1.75} /></button>
          <div className="avatar">ИХ</div>
          <input ref={inputRef} type="file" accept=".las,.dev,.asc,.segy,.sgy" multiple hidden
            onChange={(e) => { if (e.target.files) addLasFiles(e.target.files); e.target.value = ''; }} />
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div
        className={`body ${dragOver ? 'dragover' : ''}`}
        ref={bodyRef}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) addLasFiles(e.dataTransfer.files); }}
      >
        {tab === 'dashboard' ? (
          <Dashboard projectName={projectName} wells={wells} markers={markers} />
        ) : tab === 'map' ? (
          <WellMap ref={mapRef} wells={wells} markers={markers} activeWellId={activeWellId} onActivate={setActiveWell} onZoomChange={setMapZoomPct} />
        ) : tab === 'reserves' ? (
          <ReservesSummary wells={wells} markers={markers} />
        ) : tab === 'seismic' ? (
          <SeismicView wells={wells} markers={markers} />
        ) : tab === 'scene3d' ? (
          <Suspense fallback={<div className="scene3d-empty">Загрузка 3D…</div>}>
            <Scene3D wells={wells} markers={markers} activeWellId={activeWellId} />
          </Suspense>
        ) : tab === 'section' ? (
          <CrossSectionView ref={sectionRef} wells={wells} markers={markers} activeWellId={activeWellId} onZoomChange={setSectionZoomPct} />
        ) : tab === 'crossplot' ? (
          <CrossplotView ref={crossplotRef} wells={wells} markers={markers} activeWellId={activeWellId} onZoomChange={setCrossplotZoomPct} />
        ) : tab === 'tie' ? (
          <WellTie
            wells={wells}
            markers={markers}
            activeWellId={activeWellId}
            updateMarkerDepth={updateMarkerDepth}
            removeMarkerDepth={removeMarkerDepth}
            renameMarker={renameMarker}
            removeMarker={removeMarker}
            addMarkerAtDepth={addMarkerAtDepth}
          />
        ) : wells.length === 0 ? (
          <div className="empty">
            <div className="welcome">
              <div className="welcome-logo"><Logo size={34} /></div>
              <h2>GeoViewer</h2>
              <p className="welcome-sub">Каротаж, корреляция, структурные карты и подсчёт запасов — прямо в браузере.</p>
              <div className="welcome-cta">
                <button className="btn primary" onClick={() => loadDemoField()}>
                  <Layers size={16} strokeWidth={1.9} /> Открыть демо-месторождение
                </button>
                <button className="btn ghost" onClick={() => inputRef.current?.click()}>
                  <Upload size={15} strokeWidth={1.75} /> Загрузить .las
                </button>
                <button className="btn ghost" title="Интерпретировать сейсмику можно и без единой скважины"
                  onClick={() => segyInputRef.current?.click()}>
                  <Radio size={15} strokeWidth={1.75} /> Импортировать SEG-Y
                </button>
              </div>
              <div className="welcome-feats">
                <div className="welcome-feat"><Layers size={18} strokeWidth={1.6} /><b>Корреляция</b><span>разбивки, литология, привязка</span></div>
                <div className="welcome-feat"><Navigation size={18} strokeWidth={1.6} /><b>Карты и запасы</b><span>структура, изохоры, STOOIP, P90/P50/P10</span></div>
                <div className="welcome-feat"><Spline size={18} strokeWidth={1.6} /><b>Кроссплоты</b><span>φ–ρ, GR–R, гистограммы</span></div>
              </div>
              <p className="welcome-hint">Перетащите .las сюда · CSV разбивки / литология / инклинометрия — через импорт <Milestone size={12} strokeWidth={1.75} /></p>
              <input ref={segyInputRef} type="file" accept=".segy,.sgy" multiple hidden
                onChange={async (e) => {
                  if (e.target.files) { await addLasFiles(e.target.files); setTab('seismic'); }
                  e.target.value = '';
                }} />
            </div>
          </div>
        ) : (
          <>
            <div className="leftrail" style={{ width: RAIL_W }}>
              <span className="rail-comment" title="Комментарии"><MessageSquare size={15} strokeWidth={1.75} /></span>
            </div>
            <div className={`correlation tool-${tool} ${focusedWellId ? 'focused' : ''}`} ref={scrollRef}>
              {displayedWells.map((w) => (
                <WellLogPlate
                  key={w.id}
                  well={w}
                  active={w.id === activeWellId}
                  onActivate={() => setActiveWell(w.id)}
                  onRemove={() => confirmDestroy({
                    title: `Удалить скважину ${w.name}?`,
                    message: 'Каротаж, литология и все пикировки по этой скважине будут удалены без возможности восстановления.',
                    onConfirm: () => removeWell(w.id),
                  })}
                  tool={tool}
                  onCreateMarker={(depth) => addMarkerAtDepth(w.id, depth)}
                  focused={w.id === focusedWellId}
                  onToggleFocus={() => setFocusedWellId((cur) => (cur === w.id ? null : w.id))}
                  hidden={hiddenTracks[w.id]}
                  onToggleTrack={(key) => toggleTrack(w.id, key)}
                  depthWindow={effectiveWindow}
                  onDepthWindowChange={setDepthWindow}
                  cursorDepth={cursorDepth}
                  onCursorDepth={setCursorDepth}
                  scrollRef={scrollRef}
                />
              ))}
            </div>
            {selectedMarker && (
              <MarkerInspector
                marker={selectedMarker}
                wells={wells}
                onRename={(label) => renameMarker(selectedMarker.id, label)}
                onDepth={(wellId, depth) => updateMarkerDepth(selectedMarker.id, wellId, depth)}
                onRemove={() => confirmDestroy({
                  title: `Удалить разбивку «${selectedMarker.label}»?`,
                  message: 'Пикировки по всем скважинам для этой разбивки будут удалены без возможности восстановления.',
                  onConfirm: () => removeMarker(selectedMarker.id),
                })}
                onClose={() => selectMarker(null)}
              />
            )}
          </>
        )}

        {showCorrelation && (
          <CorrelationMarkers
            bodyRef={bodyRef}
            scrollRef={scrollRef}
            wells={wells}
            markers={markers}
            selectedMarkerId={selectedMarkerId}
            depthWindow={effectiveWindow}
            tick={wells.length + (focusedWellId ? 1 : 0)}
            onDragDepth={updateMarkerDepth}
            onSelect={selectMarker}
          />
        )}

        {showCorrelation && (
          <div className="fbar">
            {TOOLS.map(({ key, label, Icon }, i) => (
              <Fragment key={key}>
                {i === 2 && <span className="sep" />}
                <button className={`tbtn ${tool === key ? 'on' : ''}`} title={label} onClick={() => setTool(key)}>
                  <Icon size={18} strokeWidth={1.75} />
                </button>
              </Fragment>
            ))}
          </div>
        )}
      </div>

      <footer className="statusbar">
        {tab === 'correlation' ? (
          tool === 'marker' ? (
            <span>Клик по планшету — поставить top · тяни ручку — сдвинуть глубину (снап к пластам)</span>
          ) : cursorDepth != null ? (
            <span className="depth">Глубина: {cursorDepth.toFixed(2)}</span>
          ) : (
            <span>Колесо — зум по глубине · перетаскивание — панорама</span>
          )
        ) : TAB_HINTS[tab] ? (
          <span>{TAB_HINTS[tab]}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {(() => {
          const zoom = tab === 'map' ? { pct: mapZoomPct, reset: () => mapRef.current?.resetView() }
            : tab === 'section' ? { pct: sectionZoomPct, reset: () => sectionRef.current?.resetView() }
            : tab === 'crossplot' ? { pct: crossplotZoomPct, reset: () => crossplotRef.current?.resetView() }
            : null;
          if (!zoom || zoom.pct == null) return null;
          return (
            <span className="zoom">
              Зум {zoom.pct}%
              <button className="zoom-reset" onClick={zoom.reset}>сбросить</button>
            </span>
          );
        })()}
        {savedLabel && <span className="saved">{savedLabel}</span>}
        {tab === 'correlation' ? (
          <span>{wells.length} скв. · {markers.length} марк. · {TOOLS.find((t) => t.key === tool)?.label}</span>
        ) : tab === 'tie' ? (
          <span>{wells.length} скв. · {markers.length} марк.</span>
        ) : (
          <span>{wells.length} скв.</span>
        )}
      </footer>

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}

      <DataPanel
        open={dataPanelOpen}
        onClose={() => setDataPanelOpen(false)}
        wells={wells}
        markers={markers}
        onActivateWell={setActiveWell}
        onSelectMarker={selectMarker}
        onShow={(t, focus) => {
          setTab(t as TabKey);
          if (focus) setFocusRequest(focus);
          // The panel docks to the same right edge the marker inspector and
          // (on narrower windows) other views' own panels use — closing on
          // navigate avoids sitting on top of whatever "Показать" just opened.
          setDataPanelOpen(false);
        }}
      />

      {destroyDialog}
    </div>
  );
}

