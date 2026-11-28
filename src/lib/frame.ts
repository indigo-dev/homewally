import { useSyncExternalStore } from 'react';
import { demoId, isDemoId, uid } from './id';
import { arrayOf, isRecord, isString, oneOf, persisted, usePersisted } from './persisted';
import { t } from '../i18n';

/**
 * Photo frame: photos live in IndexedDB on this device (localStorage is far too small for images),
 * the slideshow settings in localStorage `fc.frame`. Both are per device, like to-dos and shopping.
 */

export type FrameFit = 'cover' | 'contain' | 'mat';
export type FrameOrder = 'seq' | 'shuffle';

export interface FrameSettings {
  /** photo ids that take part in the slideshow */
  selected: string[];
  intervalSec: number;
  order: FrameOrder;
  fit: FrameFit;
  /** which clock is shown, 'none' = no clock */
  clockFace: ClockFace;
  /** where the clock sits; 'solo' shows the clock without photos */
  clockLayout: ClockLayout;
  /** second hand of the analog clocks */
  seconds: boolean;
  /** date next to the clock */
  date: boolean;
  /** weather of the home place next to the clock */
  weather: boolean;
  /** today's and tomorrow's events next to the clock */
  events: boolean;
  /** slow zoom/pan while a photo is shown */
  motion: boolean;
  /** start the frame as screensaver after this many idle minutes, 0 = off */
  screensaverMin: number;
}

export interface Photo {
  id: string;
  source: 'local' | 'picsum';
  /** photographer for downloaded motifs */
  credit?: string;
  /** picsum id of a downloaded motif */
  motifId?: string;
  addedAt: number;
  width: number;
  height: number;
  full: Blob;
  thumb: Blob;
}

export const INTERVALS = [
  { sec: 10, label: '10 s' },
  { sec: 30, label: '30 s' },
  { sec: 60, label: '1 min' },
  { sec: 300, label: '5 min' },
  { sec: 900, label: '15 min' },
  { sec: 3600, label: '1 h' },
];
export const SCREENSAVER = [0, 2, 5, 10, 15, 30, 60];

export type ClockFace = 'none' | 'd-light' | 'd-bold' | 'd-flip' | 'd-words' | 'a-classic' | 'a-minimal' | 'a-dots' | 'a-roman';
export type ClockLayout = 'corner' | 'center' | 'solo';

const FACES: [Exclude<ClockFace, 'none'>, 'digital' | 'analog'][] = [
  ['d-light', 'digital'],
  ['d-bold', 'digital'],
  ['d-flip', 'digital'],
  ['d-words', 'digital'],
  ['a-classic', 'analog'],
  ['a-minimal', 'analog'],
  ['a-dots', 'analog'],
  ['a-roman', 'analog'],
];

export const CLOCK_FACES: { id: Exclude<ClockFace, 'none'>; label: string; kind: 'digital' | 'analog' }[] = FACES.map(([id, kind]) => ({
  id,
  kind,
  get label() {
    return t(`frame.faces.${id}`);
  },
}));
const FACE_IDS: ClockFace[] = ['none', ...CLOCK_FACES.map((f) => f.id)];

export const CLOCK_LAYOUTS: { id: ClockLayout; label: string }[] = (['corner', 'center', 'solo'] as const).map((id) => ({
  id,
  get label() {
    return t(`frame.layouts.${id}`);
  },
}));

export const isAnalog = (f: ClockFace) => f.startsWith('a-');

const KEY = 'fc.frame';
const DEFAULTS: FrameSettings = {
  selected: [],
  intervalSec: 60,
  order: 'seq',
  fit: 'cover',
  clockFace: 'd-light',
  clockLayout: 'corner',
  seconds: true,
  date: true,
  weather: true,
  events: false,
  motion: true,
  screensaverMin: 0,
};

/** longest edge of stored photos – sharp on an iPad Pro, small enough for many photos */
const FULL_EDGE = 2560;
const THUMB_EDGE = 420;

/* ------------------------------------------------------------------ settings */

function parseSettings(raw: unknown): FrameSettings {
  const v = isRecord(raw) ? raw : {};
  return {
    selected: arrayOf(v.selected, isString),
    intervalSec: oneOf(
      v.intervalSec,
      INTERVALS.map((i) => i.sec),
      DEFAULTS.intervalSec,
    ),
    order: oneOf(v.order, ['seq', 'shuffle'] as const, DEFAULTS.order),
    fit: oneOf(v.fit, ['cover', 'contain', 'mat'] as const, DEFAULTS.fit),
    // older versions only had an on/off switch `clock` for the simple digital clock
    clockFace: oneOf(v.clockFace, FACE_IDS, v.clock === false ? 'none' : DEFAULTS.clockFace),
    clockLayout: oneOf(v.clockLayout, ['corner', 'center', 'solo'] as const, DEFAULTS.clockLayout),
    seconds: typeof v.seconds === 'boolean' ? v.seconds : DEFAULTS.seconds,
    date: typeof v.date === 'boolean' ? v.date : DEFAULTS.date,
    weather: typeof v.weather === 'boolean' ? v.weather : DEFAULTS.weather,
    events: typeof v.events === 'boolean' ? v.events : DEFAULTS.events,
    motion: typeof v.motion === 'boolean' ? v.motion : DEFAULTS.motion,
    screensaverMin: oneOf(v.screensaverMin, SCREENSAVER, DEFAULTS.screensaverMin),
  };
}

export const frameSettings = persisted(KEY, parseSettings);

export function patchFrameSettings(patch: Partial<FrameSettings>) {
  frameSettings.set((s) => ({ ...s, ...patch }));
}

export function useFrameSettings(): FrameSettings {
  return usePersisted(frameSettings);
}

export function toggleSelected(id: string) {
  const sel = frameSettings.get().selected;
  patchFrameSettings({ selected: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
}

/* ------------------------------------------------------------------ IndexedDB */

const DB = 'fc-frame';
const STORE = 'photos';
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* ------------------------------------------------------------------ photo store */

let photos: Photo[] = [];
let loaded = false;
const photoListeners = new Set<() => void>();
const thumbUrls = new Map<string, string>();

function emitPhotos(next: Photo[]) {
  photos = next;
  photoListeners.forEach((l) => l());
}

let loading: Promise<void> | null = null;
function ensureLoaded() {
  loading ??= tx<Photo[]>('readonly', (s) => s.getAll())
    .then((all) => {
      loaded = true;
      emitPhotos(all.sort((a, b) => a.addedAt - b.addedAt));
      // drop selections of photos that no longer exist
      const ids = new Set(all.map((p) => p.id));
      const { selected } = frameSettings.get();
      if (selected.some((id) => !ids.has(id))) patchFrameSettings({ selected: selected.filter((id) => ids.has(id)) });
    })
    .catch(() => {
      loaded = true;
      emitPhotos([]);
    });
  return loading;
}

/** All photos of this device, oldest first. `null` while loading. */
export function usePhotos(): Photo[] | null {
  const list = useSyncExternalStore(
    (l) => {
      photoListeners.add(l);
      ensureLoaded();
      return () => photoListeners.delete(l);
    },
    () => photos,
  );
  return loaded ? list : null;
}

export function thumbUrl(p: Photo): string {
  let url = thumbUrls.get(p.id);
  if (!url) {
    url = URL.createObjectURL(p.thumb);
    thumbUrls.set(p.id, url);
  }
  return url;
}

export function photoById(id: string): Photo | undefined {
  return photos.find((p) => p.id === id);
}

export async function removePhotos(ids: string[]) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction(STORE, 'readwrite');
    ids.forEach((id) => t.objectStore(STORE).delete(id));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  ids.forEach((id) => {
    const u = thumbUrls.get(id);
    if (u) URL.revokeObjectURL(u);
    thumbUrls.delete(id);
  });
  const gone = new Set(ids);
  emitPhotos(photos.filter((p) => !gone.has(p.id)));
  frameSettings.set((s) => ({ ...s, selected: s.selected.filter((id) => !gone.has(id)) }));
}

async function scale(blob: Blob, edge: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const f = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * f);
  const height = Math.round(bmp.height * f);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
  if (!out) throw new Error(t('frame.convertFailed'));
  return { blob: out, width, height };
}

async function store(source: Blob, meta: Pick<Photo, 'source' | 'credit' | 'motifId'>, select: boolean, demo = false): Promise<Photo> {
  const full = await scale(source, FULL_EDGE, 0.88);
  const thumb = await scale(full.blob, THUMB_EDGE, 0.8);
  const photo: Photo = {
    id: demo ? demoId() : uid(),
    ...meta,
    addedAt: Date.now(),
    width: full.width,
    height: full.height,
    full: full.blob,
    thumb: thumb.blob,
  };
  await tx('readwrite', (s) => s.put(photo));
  emitPhotos([...photos, photo]);
  if (select) frameSettings.set((s) => ({ ...s, selected: [...s.selected, photo.id] }));
  // ask the browser not to evict the photos when space gets low
  navigator.storage?.persist?.().catch(() => {});
  return photo;
}

/** Imports photos chosen from the device; they are scaled down and selected for the slideshow. */
export async function addFiles(files: File[], onProgress?: (done: number) => void): Promise<number> {
  await ensureLoaded();
  let ok = 0;
  for (const f of files) {
    try {
      await store(f, { source: 'local' }, true);
      ok++;
    } catch {
      /* unreadable file (e.g. unsupported format) – skip */
    }
    onProgress?.(ok);
  }
  return ok;
}

/* ------------------------------------------------------------------ free motifs (picsum.photos, Unsplash licence) */

export interface Motif {
  id: string;
  author: string;
  width: number;
  height: number;
}

const MOTIF_PAGES = 10;

/** Pages 1…10 of the picsum catalogue in random order, so every visit shows other motifs first. */
export function shuffledPages(): number[] {
  return shuffle(Array.from({ length: MOTIF_PAGES }, (_, i) => i + 1));
}

export async function fetchMotifs(page: number): Promise<Motif[]> {
  const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=100`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = (await res.json()) as Motif[];
  return shuffle(list.map((m) => ({ id: String(m.id), author: m.author, width: m.width, height: m.height })));
}

export const motifThumb = (m: Motif) => `https://picsum.photos/id/${m.id}/360/240`;

/** Downloads a motif once; afterwards it works offline like an own photo. */
export async function addMotif(m: Motif, demo = false): Promise<Photo> {
  await ensureLoaded();
  const f = Math.min(1, FULL_EDGE / Math.max(m.width, m.height));
  const res = await fetch(`https://picsum.photos/id/${m.id}/${Math.round(m.width * f)}/${Math.round(m.height * f)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return store(await res.blob(), { source: 'picsum', credit: m.author, motifId: m.id }, true, demo);
}

/* ------------------------------------------------------------------ demo photos and reset */

/**
 * Downloads picsum motifs as demo photos (ids marked with the demo prefix) and selects them for the
 * slideshow. Motifs already on the device are skipped; without network the frame just gets fewer.
 */
export async function addDemoPhotos(motifIds: string[]): Promise<number> {
  await ensureLoaded();
  const have = new Set(photos.map((p) => p.motifId));
  let ok = 0;
  for (const id of motifIds.filter((x) => !have.has(x))) {
    try {
      const res = await fetch(`https://picsum.photos/id/${id}/info`);
      if (!res.ok) continue;
      const info = (await res.json()) as Motif;
      await addMotif({ id, author: info.author, width: info.width, height: info.height }, true);
      ok++;
    } catch {
      /* offline or unreadable – skip */
    }
  }
  return ok;
}

/** Deletes the demo photos, keeps the family's own. */
export async function removeDemoPhotos(): Promise<void> {
  await ensureLoaded();
  const ids = photos.filter((p) => isDemoId(p.id)).map((p) => p.id);
  if (ids.length) await removePhotos(ids);
}

/** Deletes the whole photo database of this device (factory reset). */
export async function deletePhotoDatabase(): Promise<void> {
  const open = dbPromise && (await dbPromise.catch(() => null));
  open?.close();
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
