import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useGamesSettings } from '../games/store';
import { useStore } from '../store';
import { Icon } from './Icon';
import { arrayOf, persisted, usePersisted } from '../lib/persisted';
import { isNative } from '../native/launcher';
import { t } from '../i18n';

export type ModuleId = 'dashboard' | 'calendar' | 'timetable' | 'todos' | 'shopping' | 'weather' | 'frame' | 'games' | 'apps';

/**
 * The dashboard always comes first; the others can be reordered by drag & drop.
 * "Apps" (start other Android apps) only exists in the Android app.
 */
const MODULE_ICONS: [ModuleId, string][] = [
  ['dashboard', '🏠'],
  ['calendar', '📅'],
  ['timetable', '🎒'],
  ['todos', '📌'],
  ['shopping', '🛒'],
  ['weather', '⛅'],
  ['frame', '🖼️'],
  ['games', '🎲'],
  ...(isNative ? [['apps', '📱'] as [ModuleId, string]] : []),
];

export const MODULES: { id: ModuleId; label: string; icon: string }[] = MODULE_ICONS.map(([id, icon]) => ({
  id,
  icon,
  get label() {
    return t(`nav.${id}`);
  },
}));

const ORDER_KEY = 'fc.moduleOrder';
const SORTABLE = MODULES.filter((m) => m.id !== 'dashboard').map((m) => m.id);
const HOLD_MS = 380;

export const moduleOrderStore = persisted<ModuleId[]>(ORDER_KEY, (raw) => {
  const known = arrayOf(raw, (id): id is ModuleId => SORTABLE.includes(id as ModuleId));
  // modules added later go to the end
  return [...new Set([...known, ...SORTABLE])];
});
const orderStore = moduleOrderStore;
const setOrder = (order: ModuleId[]) => orderStore.set(order);

/** position of a module in the navigation as the user sorted it */
export const navIndex = (id: ModuleId) => (id === 'dashboard' ? 0 : orderStore.get().indexOf(id) + 1);

interface Drag {
  id: ModuleId;
  pointerId: number;
  startX: number;
  startY: number;
  /** pointer position inside the button when the drag started */
  grabX: number;
  grabY: number;
  x: number;
  y: number;
  active: boolean;
  timer?: number;
}

/** App switcher: side rail on tablets, bottom bar on phones. Long press (touch) or drag (mouse) reorders. */
export function ModuleNav({ active, onSelect }: { active: ModuleId; onSelect: (id: ModuleId) => void }) {
  const order = usePersisted(orderStore);
  const games = useGamesSettings();
  const { settings } = useStore();
  const [dragging, setDragging] = useState<ModuleId | null>(null);
  const drag = useRef<Drag | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const btns = useRef(new Map<ModuleId, HTMLButtonElement>());
  const swallowClick = useRef(false);

  /** moves the dragged button under the pointer (relative to its slot in the current order) */
  const place = () => {
    const d = drag.current;
    const el = d && btns.current.get(d.id);
    if (!d || !el) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${d.x - d.grabX - r.left}px, ${d.y - d.grabY - r.top}px) scale(1.08)`;
  };
  useLayoutEffect(place, [order]);

  const vertical = () => (navRef.current ? getComputedStyle(navRef.current).flexDirection === 'column' : true);

  const start = (d: Drag) => {
    d.active = true;
    swallowClick.current = true;
    navigator.vibrate?.(10);
    setDragging(d.id);
    place();
  };

  const finish = () => {
    const d = drag.current;
    if (d?.timer) window.clearTimeout(d.timer);
    if (d) {
      const el = btns.current.get(d.id);
      if (el) el.style.transform = '';
    }
    drag.current = null;
    setDragging(null);
  };

  // no page scrolling / pull-to-refresh on iOS while a button is held
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const block = (e: TouchEvent) => {
      if (drag.current?.active) e.preventDefault();
    };
    nav.addEventListener('touchmove', block, { passive: false });
    return () => nav.removeEventListener('touchmove', block);
  }, []);

  const onPointerDown = (id: ModuleId) => (e: RPointerEvent<HTMLButtonElement>) => {
    if (id === 'dashboard' || e.button !== 0) return;
    swallowClick.current = false;
    const r = e.currentTarget.getBoundingClientRect();
    const d: Drag = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
      x: e.clientX,
      y: e.clientY,
      active: false,
    };
    // touch / pen: hold to pick up; mouse: just drag
    if (e.pointerType !== 'mouse') d.timer = window.setTimeout(() => drag.current === d && start(d), HOLD_MS);
    drag.current = d;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active) {
      const dist = Math.hypot(d.x - d.startX, d.y - d.startY);
      if (e.pointerType === 'mouse' ? dist > 6 : false) start(d);
      else if (dist > 10) finish(); // finger moved before the hold: no reorder
      return;
    }
    place();
    // new index: count the other sortable buttons whose centre lies before the pointer
    const v = vertical();
    const pos = v ? d.y : d.x;
    const others = order.filter((id) => id !== d.id);
    let idx = 0;
    for (const id of others) {
      const r = btns.current.get(id)?.getBoundingClientRect();
      if (r && pos > (v ? r.top + r.height / 2 : r.left + r.width / 2)) idx++;
    }
    const next = [...others];
    next.splice(idx, 0, d.id);
    if (next.join() !== order.join()) setOrder(next);
  };

  // the games corner only appears when it is switched on for this device, the timetable only with the school area
  const list = [MODULES[0], ...order.map((id) => MODULES.find((m) => m.id === id)!)].filter(
    (m) => (m.id !== 'games' || games.enabled) && (m.id !== 'timetable' || settings.schoolEnabled),
  );

  return (
    <nav ref={navRef} className={`module-nav ${dragging ? 'sorting' : ''}`} aria-label={t('app.sections')}>
      <span className="module-nav-label">{t('app.family')}</span>
      {list.map((m) => (
        <button
          key={m.id}
          ref={(el) => {
            if (el) btns.current.set(m.id, el);
            else btns.current.delete(m.id);
          }}
          className={`module-btn ${active === m.id ? 'active' : ''} ${dragging === m.id ? 'lifted' : ''} ${
            m.id === 'dashboard' ? 'pinned' : ''
          }`}
          data-module={m.id}
          aria-current={active === m.id ? 'page' : undefined}
          title={m.id === 'dashboard' ? undefined : t('nav.sortHint')}
          onPointerDown={onPointerDown(m.id)}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (swallowClick.current) {
              swallowClick.current = false;
              return;
            }
            onSelect(m.id);
          }}
        >
          <span className="module-icon ui-glyph" aria-hidden>
            {m.icon}
          </span>
          <Icon name={m.id} className="module-svg" />
          <span className="module-label">{m.label}</span>
        </button>
      ))}
    </nav>
  );
}
