import type { Marker, Well } from './types';
import { uid } from './util/id';

/**
 * Multi-project persistence over IndexedDB.
 *  - store `projects`: full project data keyed by id.
 *  - store `meta` (key "app"): { activeId, list } — a light index so the
 *    project switcher doesn't have to load every project's data.
 */

const DB_NAME = 'geoviewer';
const VERSION = 2;
const PROJECTS = 'projects';
const META = 'meta';
const META_KEY = 'app';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
}

export interface ProjectData {
  wells: Well[];
  markers: Marker[];
  activeWellId: string | null;
  /** View settings: track titles / LITHO_KEY hidden per well. */
  hiddenTracks?: Record<string, string[]>;
}

interface AppMeta {
  activeId: string;
  list: ProjectMeta[];
}

const emptyData = (): ProjectData => ({ wells: [], markers: [], activeWellId: null, hiddenTracks: {} });

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

const getMeta = () => tx<AppMeta | undefined>(META, 'readonly', (s) => s.get(META_KEY));
const putMeta = (m: AppMeta) => tx(META, 'readwrite', (s) => s.put(m, META_KEY));
const getProject = (id: string) => tx<ProjectData | undefined>(PROJECTS, 'readonly', (s) => s.get(id));
const putProject = (id: string, d: ProjectData) => tx(PROJECTS, 'readwrite', (s) => s.put(d, id));
const delProject = (id: string) => tx(PROJECTS, 'readwrite', (s) => s.delete(id));

function touchList(list: ProjectMeta[], id: string, name?: string): ProjectMeta[] {
  const now = Date.now();
  const found = list.find((p) => p.id === id);
  if (found) {
    return list.map((p) => (p.id === id ? { ...p, name: name ?? p.name, updatedAt: now } : p));
  }
  return [...list, { id, name: name ?? 'Проект', updatedAt: now }];
}

export interface Bootstrap {
  activeId: string;
  name: string;
  list: ProjectMeta[];
  data: ProjectData;
}

/** Ensure at least one project exists; return the active project + list. */
export async function bootstrap(): Promise<Bootstrap> {
  let meta = await getMeta();
  if (!meta || meta.list.length === 0) {
    const id = uid();
    const name = 'Корреляция';
    meta = { activeId: id, list: [{ id, name, updatedAt: Date.now() }] };
    await putProject(id, emptyData());
    await putMeta(meta);
    return { activeId: id, name, list: meta.list, data: emptyData() };
  }
  const activeId = meta.list.some((p) => p.id === meta!.activeId) ? meta.activeId : meta.list[0].id;
  const data = (await getProject(activeId)) ?? emptyData();
  const name = meta.list.find((p) => p.id === activeId)!.name;
  return { activeId, name, list: meta.list, data };
}

/** Save project data and refresh its meta entry; returns the updated list. */
export async function persist(id: string, name: string, data: ProjectData): Promise<ProjectMeta[]> {
  await putProject(id, data);
  const meta = (await getMeta()) ?? { activeId: id, list: [] };
  const list = touchList(meta.list, id, name);
  await putMeta({ activeId: id, list });
  return list;
}

export async function createProject(name: string): Promise<{ id: string; list: ProjectMeta[]; data: ProjectData }> {
  const id = uid();
  const data = emptyData();
  await putProject(id, data);
  const meta = (await getMeta()) ?? { activeId: id, list: [] };
  const list = touchList(meta.list, id, name);
  await putMeta({ activeId: id, list });
  return { id, list, data };
}

export async function renameProject(id: string, name: string): Promise<ProjectMeta[]> {
  const meta = await getMeta();
  if (!meta) return [];
  const list = meta.list.map((p) => (p.id === id ? { ...p, name } : p));
  await putMeta({ ...meta, list });
  return list;
}

export async function switchProject(id: string): Promise<{ name: string; list: ProjectMeta[]; data: ProjectData }> {
  const meta = await getMeta();
  const list = meta?.list ?? [];
  await putMeta({ activeId: id, list });
  const data = (await getProject(id)) ?? emptyData();
  const name = list.find((p) => p.id === id)?.name ?? 'Проект';
  return { name, list, data };
}

export async function deleteProject(id: string): Promise<Bootstrap> {
  await delProject(id);
  const meta = await getMeta();
  let list = (meta?.list ?? []).filter((p) => p.id !== id);
  if (list.length === 0) {
    const created = await createProject('Корреляция');
    return { activeId: created.id, name: 'Корреляция', list: created.list, data: created.data };
  }
  const activeId = list[0].id;
  await putMeta({ activeId, list });
  const data = (await getProject(activeId)) ?? emptyData();
  return { activeId, name: list.find((p) => p.id === activeId)!.name, list, data };
}
