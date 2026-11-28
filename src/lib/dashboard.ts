import { uid } from './id';
import { arrayOf, isRecord, persisted, usePersisted } from './persisted';
import { t } from '../i18n';
import { isNative } from '../native/launcher';

/**
 * Dashboard layout: an ordered list of widgets, each with a size step. The grid packs them densely
 * in that order. Stored per device in localStorage `fc.dashboard` (like photos and weather places).
 */

export type WidgetType =
  'clock' | 'weather' | 'events' | 'timetable' | 'todos' | 'shopping' | 'photos' | 'holidays' | 'pollen' | 'family' | 'app' | 'battery';

/** Klein 1×1, Mittel 2×1, Hoch 1×2, Groß 2×2, Breit 3×2 */
export type WidgetSize = 's' | 'm' | 't' | 'l' | 'xl';

const size = (id: WidgetSize, w: number, h: number) => ({
  w,
  h,
  get label() {
    return t(`dashboard.sizes.${id}`);
  },
});

export const SIZES: Record<WidgetSize, { w: number; h: number; label: string }> = {
  s: size('s', 1, 1),
  m: size('m', 2, 1),
  t: size('t', 1, 2),
  l: size('l', 2, 2),
  xl: size('xl', 3, 2),
};

export interface WidgetDef {
  type: WidgetType;
  title: string;
  icon: string;
  description: string;
  sizes: WidgetSize[];
  /** module opened by tapping the widget */
  module?: 'calendar' | 'timetable' | 'todos' | 'shopping' | 'weather' | 'frame';
}

const DEFS: Omit<WidgetDef, 'title' | 'description'>[] = [
  { type: 'clock', icon: '🕰️', sizes: ['s', 'm'] },
  { type: 'events', icon: '📅', sizes: ['m', 't', 'l', 'xl'], module: 'calendar' },
  { type: 'family', icon: '👨‍👩‍👧', sizes: ['m', 't', 'l', 'xl'], module: 'calendar' },
  { type: 'weather', icon: '⛅', sizes: ['s', 'm', 'l', 'xl'], module: 'weather' },
  { type: 'pollen', icon: '🌼', sizes: ['s', 'm'], module: 'weather' },
  { type: 'timetable', icon: '🎒', sizes: ['s', 'm', 't', 'l', 'xl'], module: 'timetable' },
  { type: 'todos', icon: '📌', sizes: ['s', 'm', 't', 'l'], module: 'todos' },
  { type: 'shopping', icon: '🛒', sizes: ['s', 'm', 't', 'l'], module: 'shopping' },
  { type: 'photos', icon: '🖼️', sizes: ['s', 'm', 't', 'l', 'xl'], module: 'frame' },
  { type: 'holidays', icon: '🏖️', sizes: ['s', 'm'] },
  // Android-only widgets: app shortcut tiles and live tablet battery monitor
  ...(isNative
    ? [
        { type: 'battery' as const, icon: '🔋', sizes: ['s' as const, 'm' as const, 't' as const] },
        { type: 'app' as const, icon: '📱', sizes: ['s' as const] },
      ]
    : []),
];

/** the widgets with title and description in the active language */
export const WIDGETS: WidgetDef[] = DEFS.map((d) => ({
  ...d,
  get title() {
    return t(`dashboard.widgets.${d.type}.title`);
  },
  get description() {
    return t(`dashboard.widgets.${d.type}.description`);
  },
}));

export const widgetDef = (type: WidgetType) => WIDGETS.find((w) => w.type === type)!;

/** the Android app an app tile starts */
export interface AppLink {
  packageName: string;
  activity: string;
  label: string;
}

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  /** only for type 'app' */
  app?: AppLink;
  /** cell placed by hand, per column count ('6', '4', '2'); without one the widget fills the first free place */
  pos?: Record<string, { x: number; y: number }>;
}

const isCell = (c: unknown): c is { x: number; y: number } =>
  isRecord(c) && Number.isInteger(c.x) && Number.isInteger(c.y) && (c.x as number) >= 0 && (c.y as number) >= 0;

/** keeps only valid hand-placed cells */
function cleanPos(w: WidgetInstance): WidgetInstance {
  if (w.pos === undefined) return w;
  const pos = isRecord(w.pos) ? Object.fromEntries(Object.entries(w.pos).filter(([, c]) => isCell(c))) : {};
  const { pos: _, ...rest } = w;
  return Object.keys(pos).length ? { ...rest, pos: pos as WidgetInstance['pos'] } : rest;
}

const isAppLink = (a: unknown): a is AppLink =>
  isRecord(a) && typeof a.packageName === 'string' && typeof a.activity === 'string' && typeof a.label === 'string';

/** Fills 6×3 on an iPad in landscape. */
const DEFAULT_LAYOUT: [WidgetType, WidgetSize][] = [
  ['clock', 'm'],
  ['weather', 'm'],
  ['holidays', 's'],
  ['pollen', 's'],
  ['events', 'l'],
  ['timetable', 't'],
  ['todos', 't'],
  ['shopping', 't'],
  ['photos', 't'],
];

const KEY = 'fc.dashboard';

function defaults(): WidgetInstance[] {
  return DEFAULT_LAYOUT.map(([type, size]) => ({ id: uid(), type, size }));
}

const isWidget = (w: unknown): w is WidgetInstance =>
  isRecord(w) &&
  typeof w.id === 'string' &&
  WIDGETS.some((d) => d.type === w.type) &&
  widgetDef(w.type as WidgetType).sizes.includes(w.size as WidgetSize) &&
  (w.type !== 'app' || isAppLink(w.app));

/** nothing stored yet = the default layout */
export const dashboardLayout = persisted<WidgetInstance[]>(KEY, (raw) =>
  Array.isArray(raw) ? arrayOf(raw, isWidget).map(cleanPos) : defaults(),
);
const layout = dashboardLayout;

export function useLayout(): WidgetInstance[] {
  return usePersisted(layout);
}

export function addWidget(type: WidgetType, size: WidgetSize) {
  layout.set((l) => [...l, { id: uid(), type, size }]);
}

/** adds a 1×1 tile that starts an Android app */
export function addAppTile(app: AppLink) {
  const { packageName, activity, label } = app;
  layout.set((l) => [...l, { id: uid(), type: 'app', size: 's', app: { packageName, activity, label } }]);
}

export function removeWidget(id: string) {
  layout.set((l) => l.filter((w) => w.id !== id));
}

export function resizeWidget(id: string, size: WidgetSize) {
  layout.set((l) => l.map((w) => (w.id === id ? { ...w, size } : w)));
}

/** moves widget `id` to the position of `targetId` */
export function moveWidget(id: string, targetId: string) {
  layout.set((l) => {
    const from = l.findIndex((w) => w.id === id);
    const to = l.findIndex((w) => w.id === targetId);
    if (from < 0 || to < 0 || from === to) return l;
    const next = [...l];
    const [w] = next.splice(from, 1);
    next.splice(to, 0, w);
    return next;
  });
}

/**
 * Fixes the cells of the given widgets for this column count (after moving one by hand). The list is
 * sorted into reading order, so the other column counts follow the new arrangement roughly.
 */
export function setPositions(cols: number, cells: Record<string, { x: number; y: number }>) {
  layout.set((l) => {
    const key = String(cols);
    const placed = l.map((w) => (cells[w.id] ? { ...w, pos: { ...w.pos, [key]: cells[w.id] } } : w));
    const rank = (w: WidgetInstance) => (cells[w.id] ? cells[w.id].y * 1000 + cells[w.id].x : Infinity);
    return placed
      .map((w, i) => ({ w, i }))
      .sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i)
      .map(({ w }) => w);
  });
}

export function resetLayout() {
  layout.set(defaults());
}
