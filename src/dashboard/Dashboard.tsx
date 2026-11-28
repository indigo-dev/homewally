import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useStore } from '../store';
import { addDays, dayKey, startOfDay } from '../lib/dates';
import { proxyOf, useEvents } from '../lib/events';
import { useHolidayMarks } from '../lib/holidays';
import { useSize } from '../lib/hooks';
import { useTodos } from '../lib/todos';
import { useShopping } from '../lib/shopping';
import {
  addWidget,
  addAppTile,
  setPositions,
  removeWidget,
  resetLayout,
  resizeWidget,
  SIZES,
  useLayout,
  widgetDef,
  WIDGETS,
  type WidgetInstance,
  type WidgetSize,
} from '../lib/dashboard';
import type { ModuleId } from '../components/ModuleNav';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Modal } from '../components/Modal';
import type { SettingsTab } from '../settings/SettingsPanel';
import { DashCtx, WIDGET_COMPONENTS, type DashData } from './widgets';
import './dashboard.css';
import { useToday } from '../lib/clock';
import { t } from '../i18n';
import { launchApp } from '../native/launcher';
import { AppPicker } from '../apps/AppPicker';
import { GAP, gridGeometry } from './geometry';
import { arrange, fitsAt, freeCells, rowsOf, type Cell } from './pack';

const LONG_PRESS_MS = 550;
/** short hold in edit mode on touch so swiping still scrolls a full dashboard */
const EDIT_LONG_PRESS_MS = 280;
/** how long a dragged widget rests over a place before it moves there */
const DWELL_MS = 220;
/** top/bottom edge band (px) that auto-scrolls the grid while dragging a widget */
const EDGE_SCROLL_PX = 64;
const EDGE_SCROLL_MAX = 12;

interface Props {
  reloadKey: number;
  editing: boolean;
  onEditing: (on: boolean) => void;
  openModule: (id: ModuleId) => void;
  startFrame: (startId?: string) => void;
  /** tap on the clock: the screensaver exactly as set up in the photo frame */
  startScreensaver: () => void;
  openSettings: (tab?: SettingsTab) => void;
}

export function Dashboard({ reloadKey, editing, onEditing, openModule, startFrame, startScreensaver, openSettings }: Props) {
  const { members, calendars, settings } = useStore();
  const stored = useLayout();
  // without the school area its widgets stay in the layout, just hidden (they come back when it is switched on)
  const layout = useMemo(
    () => (settings.schoolEnabled ? stored : stored.filter((w) => w.type !== 'timetable')),
    [stored, settings.schoolEnabled],
  );
  const [stageRef, stageSize] = useSize<HTMLDivElement>();
  const [gridRef, size] = useSize<HTMLDivElement>();
  const [gallery, setGallery] = useState(false);

  /* ---------------- shared data for all widgets */
  const todayKey = dayKey(useToday());
  const range = useMemo(() => {
    const start = startOfDay(new Date(todayKey + 'T12:00'));
    return { start, end: addDays(start, 2) };
  }, [todayKey]);
  const marksRange = useMemo(() => ({ start: range.start, end: addDays(range.start, 21) }), [range.start]);
  const holidaySettings = useMemo(
    () => ({ region: settings.holidays.region, showPublic: true, showSchool: true }),
    [settings.holidays.region],
  );
  const { marks } = useHolidayMarks(marksRange, holidaySettings);

  const [nonce, setNonce] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else setNonce((n) => n + 1);
  }, [reloadKey]);
  useEffect(() => {
    const t = setInterval(() => setNonce((n) => n + 1), settings.refreshMinutes * 60_000);
    const onVis = () => document.visibilityState === 'visible' && setNonce((n) => n + 1);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [settings.refreshMinutes]);
  const { events: raw } = useEvents(range, members, calendars, proxyOf(settings), nonce);
  const events = useMemo(() => {
    const ids = new Set(members.map((m) => m.id));
    return raw
      .map((e) => ({ ...e, memberIds: e.memberIds.filter((id) => ids.has(id)) }))
      .filter((e) => Boolean(e.birthdayId) || e.memberIds.length > 0);
  }, [raw, members]);

  const todos = useTodos();
  const shopping = useShopping();
  const data = useMemo<DashData>(
    () => ({ events, todos, shopping, marks, openModule, startFrame, openSettings }),
    [events, todos, shopping, marks, openModule, startFrame, openSettings],
  );

  /* ---------------- grid geometry */
  // height comes from the outer stage (minus .dash's net 10px vertical padding) so showing the edit
  // toolbar never shrinks the measured height and never stretches the rows in edit mode
  const gridHeight = stageSize.height > 0 ? Math.max(0, stageSize.height - 10) : size.height;
  const { cols, cellW, rowH } = gridGeometry(size.width, gridHeight);
  // where every widget sits (hand-placed ones keep their cell), and the free cells in between
  const boxes = useMemo(() => layout.map((w) => ({ w: Math.min(SIZES[w.size].w, cols), h: SIZES[w.size].h })), [layout, cols]);
  const cells = useMemo(
    () =>
      arrange(
        layout.map((w, i) => ({ ...boxes[i], pos: w.pos?.[String(cols)] })),
        cols,
      ),
    [layout, boxes, cols],
  );
  const rows = rowsOf(boxes, cells);
  // while editing one empty row more at the bottom, to move a widget there
  const free = editing ? freeCells(boxes, cells, cols, rows + 1) : [];
  // the drag handler is set up once; it reads the current arrangement from here
  const geo = useRef({ layout, boxes, cells, cols, cellW, rowH });
  useLayoutEffect(() => {
    geo.current = { layout, boxes, cells, cols, cellW, rowH };
  });

  /* ---------------- long press, drag & drop */
  const press = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    curX: number;
    curY: number;
    armed: boolean;
    timer?: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; offX: number; offY: number; w: number; h: number } | null>(null);
  const lastTarget = useRef<string | null>(null);
  /** where the finger holds the dragged widget (set once the drag has started) */
  const dragOff = useRef<{ x: number; y: number } | null>(null);
  const dragPos = useRef<{ x: number; y: number } | null>(null);
  const dragId = useRef<string | null>(null);
  /** timer until the dragged widget takes the place it rests over */
  const dwell = useRef(0);
  const scrollRaf = useRef(0);
  const beginDragRef = useRef<(id: string, originX: number, originY: number, curX: number, curY: number) => boolean>(() => false);

  // while armed/dragging, touch browsers (Android WebView, iOS) must not scroll the page
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (press.current?.armed || dragId.current) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [gridRef]);

  const endPress = () => {
    if (press.current?.timer) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  useEffect(() => {
    const stopAutoScroll = () => {
      if (scrollRaf.current) {
        cancelAnimationFrame(scrollRaf.current);
        scrollRaf.current = 0;
      }
    };
    /** moves the dragged widget to `cell` if it is free, or swaps it with a widget of the same size there */
    const place = (id: string, cell: Cell) => {
      const g = geo.current;
      const idx = g.layout.findIndex((w) => w.id === id);
      if (idx < 0) return;
      const cur = g.cells[idx];
      if (cur.x === cell.x && cur.y === cell.y) return;
      const fixed = Object.fromEntries(g.layout.map((w, i) => [w.id, g.cells[i]]));
      if (fitsAt(g.boxes, g.cells, idx, cell, g.cols)) {
        setPositions(g.cols, { ...fixed, [id]: cell });
        return;
      }
      const other = g.cells.findIndex(
        (c, i) => i !== idx && c.x === cell.x && c.y === cell.y && g.boxes[i].w === g.boxes[idx].w && g.boxes[i].h === g.boxes[idx].h,
      );
      if (other >= 0) setPositions(g.cols, { ...fixed, [id]: cell, [g.layout[other].id]: cur });
    };
    // the cell under the dragged widget's top-left corner: free → it moves there,
    // a widget of the same size → the two swap places
    const updateTarget = (id: string, clientX: number, clientY: number) => {
      const g = geo.current;
      const grid = gridRef.current;
      const off = dragOff.current;
      const idx = g.layout.findIndex((w) => w.id === id);
      if (!grid || !off || idx < 0) return;
      const box = grid.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(grid).paddingLeft) || 0;
      const gx = clientX - off.x - box.left - pad;
      const gy = clientY - off.y - box.top - pad + grid.scrollTop;
      const cell: Cell = {
        x: Math.max(0, Math.min(g.cols - g.boxes[idx].w, Math.round(gx / (g.cellW + GAP)))),
        y: Math.max(0, Math.round(gy / (g.rowH + GAP))),
      };
      const key = `${cell.x},${cell.y}`;
      if (key === lastTarget.current) return;
      lastTarget.current = key;
      // only when the widget rests over a place for a moment – passing over others must not reshuffle them
      window.clearTimeout(dwell.current);
      dwell.current = window.setTimeout(() => place(id, cell), DWELL_MS);
    };
    const startAutoScroll = () => {
      if (scrollRaf.current) return;
      const step = () => {
        const id = dragId.current;
        const pos = dragPos.current;
        const grid = gridRef.current;
        if (!id || !pos || !grid) {
          scrollRaf.current = 0;
          return;
        }
        const box = grid.getBoundingClientRect();
        let dy = 0;
        if (pos.y < box.top + EDGE_SCROLL_PX) {
          const ratio = Math.min(1, (box.top + EDGE_SCROLL_PX - pos.y) / EDGE_SCROLL_PX);
          dy = -Math.ceil(ratio * EDGE_SCROLL_MAX);
        } else if (pos.y > box.bottom - EDGE_SCROLL_PX) {
          const ratio = Math.min(1, (pos.y - (box.bottom - EDGE_SCROLL_PX)) / EDGE_SCROLL_PX);
          dy = Math.ceil(ratio * EDGE_SCROLL_MAX);
        }
        if (dy !== 0) {
          const before = grid.scrollTop;
          grid.scrollTop += dy;
          if (grid.scrollTop !== before) updateTarget(id, pos.x, pos.y);
        }
        scrollRaf.current = requestAnimationFrame(step);
      };
      scrollRaf.current = requestAnimationFrame(step);
    };
    const beginDrag = (id: string, originX: number, originY: number, curX: number, curY: number) => {
      const el = document.querySelector<HTMLElement>(`[data-wid="${id}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      suppressClick.current = true;
      lastTarget.current = null;
      dragOff.current = { x: originX - r.left, y: originY - r.top };
      dragPos.current = { x: curX, y: curY };
      dragId.current = id;
      setDrag({ id, x: curX, y: curY, offX: originX - r.left, offY: originY - r.top, w: r.width, h: r.height });
      startAutoScroll();
      return true;
    };
    beginDragRef.current = beginDrag;

    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      p.curX = e.clientX;
      p.curY = e.clientY;
      const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (!p.armed) {
        if (dist > 10) endPress(); // a scroll, not a long press
        return;
      }
      if (!dragOff.current) {
        if (dist < 6) return;
        if (!beginDrag(p.id, p.x, p.y, e.clientX, e.clientY)) return;
      } else {
        dragPos.current = { x: e.clientX, y: e.clientY };
        setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY });
      }
      updateTarget(p.id, e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (press.current && e.pointerId !== press.current.pointerId) return;
      endPress();
      stopAutoScroll();
      // let go over a place: it counts at once
      if (dwell.current && dragOff.current && lastTarget.current) {
        window.clearTimeout(dwell.current);
        const [x, y] = lastTarget.current.split(',').map(Number);
        if (dragId.current) place(dragId.current, { x, y });
      }
      dwell.current = 0;
      dragOff.current = null;
      dragPos.current = null;
      dragId.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      stopAutoScroll();
      window.clearTimeout(dwell.current);
      endPress();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [gridRef]);

  const onPointerDown = (w: WidgetInstance) => (e: RPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.dw-edit-btn')) return;
    suppressClick.current = false;
    // mouse drags immediately (wheel/scrollbar handles scrolling); touch/pen uses a short hold so swiping scrolls
    const immediate = editing && e.pointerType === 'mouse';
    const p = {
      id: w.id,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      armed: immediate,
      timer: undefined as number | undefined,
    };
    if (editing && !immediate) {
      p.timer = window.setTimeout(() => {
        if (press.current !== p) return;
        p.armed = true;
        navigator.vibrate?.(12);
        beginDragRef.current(p.id, p.x, p.y, p.curX, p.curY);
      }, EDIT_LONG_PRESS_MS);
    } else if (!editing) {
      // interactive parts (checkboxes, items) keep their own tap
      if ((e.target as HTMLElement).closest('button')) return;
      p.timer = window.setTimeout(() => {
        if (press.current !== p) return;
        p.armed = true;
        suppressClick.current = true;
        navigator.vibrate?.(10);
        onEditing(true);
      }, LONG_PRESS_MS);
    }
    press.current = p;
  };

  const onClick = (w: WidgetInstance) => () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (editing) return;
    if (w.type === 'clock') return startScreensaver();
    if (w.type === 'app') {
      if (w.app) launchApp(w.app).catch(() => {});
      return;
    }
    const mod = widgetDef(w.type).module;
    if (mod) openModule(mod);
  };

  /* ---------------- size menu */
  const [sizeMenu, setSizeMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [wasEditing, setWasEditing] = useState(editing);
  if (wasEditing !== editing) {
    setWasEditing(editing);
    if (!editing) setSizeMenu(null);
  }
  const menuWidget = sizeMenu && layout.find((w) => w.id === sizeMenu.id);

  /* ---------------- smooth layout changes (FLIP): widgets glide from their old place and size */
  const flipBoxes = useRef(new Map<string, { x: number; y: number; w: number; h: number; size: WidgetSize }>());
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const prev = flipBoxes.current;
    const next = new Map<string, { x: number; y: number; w: number; h: number; size: WidgetSize }>();
    grid.querySelectorAll<HTMLElement>(':scope > [data-wid]').forEach((el) => {
      const id = el.dataset.wid!;
      const box = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, size: el.dataset.size as WidgetSize };
      next.set(id, box);
      if (reduce || !el.animate) return;
      const old = prev.get(id);
      if (!old) {
        if (prev.size > 0)
          el.animate(
            [
              { opacity: 0, scale: '0.9' },
              { opacity: 1, scale: '1' },
            ],
            { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' },
          );
        return;
      }
      const dx = old.x + old.w / 2 - (box.x + box.w / 2);
      const dy = old.y + old.h / 2 - (box.y + box.h / 2);
      const sx = old.w / box.w;
      const sy = old.h / box.h;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return;
      // `translate`/`scale` are separate from `transform`, so the wiggle keeps running
      el.animate(
        [
          { translate: `${dx}px ${dy}px`, scale: `${sx} ${sy}` },
          { translate: '0 0', scale: '1 1' },
        ],
        {
          duration: 380,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        },
      );
      // new size: let the content fade in instead of showing it stretched
      if (old.size !== box.size) {
        el.querySelector('.dw-inner')?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: 380 });
      }
    });
    flipBoxes.current = next;
  }, [layout, cols, rowH, size.width, gridRef]);

  const dragged = drag && layout.find((w) => w.id === drag.id);

  return (
    <DashCtx.Provider value={data}>
      <div ref={stageRef} className="dash-stage">
        {editing && (
          <div className="dash-toolbar">
            <span className="dash-hint muted">{t('dashboard.hint')}</span>
            <span className="board-spacer" />
            <button className="btn ghost" onClick={() => confirm(t('dashboard.confirmReset')) && resetLayout()}>
              {t('common.reset')}
            </button>
            <button className="btn" onClick={() => setGallery(true)}>
              {t('dashboard.addWidget')}
            </button>
            <button className="btn primary" onClick={() => onEditing(false)}>
              {t('common.done')}
            </button>
          </div>
        )}
        <main
          ref={gridRef}
          className={`dash ${editing ? 'editing' : ''} ${drag ? 'dragging' : ''}`}
          style={{ '--cols': cols, '--row': `${rowH}px`, '--gap': `${GAP}px` } as CSSProperties}
        >
          {size.width > 0 &&
            layout.map((w, i) => {
              const s = SIZES[w.size];
              const Comp = WIDGET_COMPONENTS[w.type];
              const span = Math.min(s.w, cols);
              // wiggle angle so the corners move ~1.2px whatever the widget's size
              const halfDiag = Math.hypot(span * cellW + (span - 1) * GAP, s.h * rowH + (s.h - 1) * GAP) / 2;
              const wig = Math.min(0.9, Math.max(0.12, (1.2 / halfDiag) * (180 / Math.PI)));
              return (
                <section
                  key={w.id}
                  data-wid={w.id}
                  data-size={w.size}
                  className={`dw dw-${w.type} size-${w.size} ${drag?.id === w.id ? 'placeholder' : ''} ${sizeMenu?.id === w.id ? 'menu-open' : ''}`}
                  style={
                    {
                      gridColumn: `${cells[i].x + 1} / span ${span}`,
                      gridRow: `${cells[i].y + 1} / span ${s.h}`,
                      '--i': i,
                      '--wig': `${wig.toFixed(3)}deg`,
                    } as CSSProperties
                  }
                  onPointerDown={onPointerDown(w)}
                  onClick={onClick(w)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <div className="dw-inner">
                    <ErrorBoundary label={widgetDef(w.type).title} compact>
                      <Comp size={w.size} widget={w} />
                    </ErrorBoundary>
                  </div>
                  {editing && (
                    <>
                      <button
                        className="dw-edit-btn dw-remove"
                        aria-label={t('dashboard.removeWidget', { title: widgetDef(w.type).title })}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeWidget(w.id);
                        }}
                      >
                        −
                      </button>
                      {widgetDef(w.type).sizes.length > 1 && (
                        <button
                          className="dw-edit-btn dw-resize"
                          aria-label={t('dashboard.resize', { size: SIZES[w.size].label, w: s.w, h: s.h })}
                          aria-haspopup="menu"
                          aria-expanded={sizeMenu?.id === w.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setSizeMenu((m) => (m?.id === w.id ? null : { id: w.id, rect }));
                          }}
                        >
                          <SizeGlyph size={w.size} />
                          {s.w}×{s.h}
                        </button>
                      )}
                    </>
                  )}
                </section>
              );
            })}
          {/* free places while editing: a widget can be moved into any of them */}
          {size.width > 0 &&
            free.map((c) => (
              <div
                key={`hole-${c.x}-${c.y}`}
                className="dash-hole"
                aria-hidden
                style={{ gridColumn: `${c.x + 1} / span 1`, gridRow: `${c.y + 1} / span 1` }}
              />
            ))}
          {size.width > 0 && layout.length === 0 && (
            <div className="dash-empty">
              <p>{t('dashboard.empty')}</p>
              <button
                className="btn primary"
                onClick={() => {
                  onEditing(true);
                  setGallery(true);
                }}
              >
                {t('dashboard.addWidgetLong')}
              </button>
            </div>
          )}
        </main>
      </div>
      {drag && dragged && (
        <div
          className={`dw dw-${dragged.type} size-${dragged.size} dw-ghost`}
          style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.w, height: drag.h }}
        >
          <div className="dw-inner">
            {(() => {
              const Comp = WIDGET_COMPONENTS[dragged.type];
              return <Comp size={dragged.size} widget={dragged} />;
            })()}
          </div>
        </div>
      )}
      {gallery && <Gallery onClose={() => setGallery(false)} />}
      {sizeMenu && menuWidget && (
        <SizeMenu
          widget={menuWidget}
          anchor={sizeMenu.rect}
          onPick={(s) => {
            resizeWidget(menuWidget.id, s);
            setSizeMenu(null);
          }}
          onClose={() => setSizeMenu(null)}
        />
      )}
    </DashCtx.Provider>
  );
}

/** footprint of a widget size, drawn in a 3×2 grid */
function SizeGlyph({ size }: { size: WidgetSize }) {
  const { w, h } = SIZES[size];
  return (
    <span className="size-glyph" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <i key={i} className={i % 3 < w && Math.floor(i / 3) < h ? 'on' : ''} />
      ))}
    </span>
  );
}

const MENU_W = 250;

/** pick one of the sizes the widget offers – shown next to the size button, outside the wiggling grid */
function SizeMenu({
  widget,
  anchor,
  onPick,
  onClose,
}: {
  widget: WidgetInstance;
  anchor: DOMRect;
  onPick: (s: WidgetSize) => void;
  onClose: () => void;
}) {
  const def = widgetDef(widget.type);
  const height = 44 + def.sizes.length * 54;
  const below = anchor.bottom + 8 + height < window.innerHeight;
  const top = below ? anchor.bottom + 8 : Math.max(8, anchor.top - 8 - height);
  const left = Math.min(window.innerWidth - MENU_W - 8, Math.max(8, anchor.right - MENU_W));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="size-menu-backdrop" onPointerDown={onClose} />
      <div
        className="size-menu"
        role="menu"
        aria-label={t('dashboard.sizeOf', { title: def.title })}
        style={{ top, left, '--origin': below ? 'top right' : 'bottom right' } as CSSProperties}
      >
        <div className="size-menu-title">{t('dashboard.sizeTitle', { title: def.title })}</div>
        {def.sizes.map((s) => (
          <button
            key={s}
            role="menuitemradio"
            aria-checked={widget.size === s}
            className={`size-opt ${widget.size === s ? 'on' : ''}`}
            onClick={() => onPick(s)}
          >
            <span className="size-opt-glyph">
              <SizeGlyph size={s} />
            </span>
            <span className="size-opt-label">{SIZES[s].label}</span>
            <span className="size-opt-dim">
              {SIZES[s].w} × {SIZES[s].h}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function Gallery({ onClose }: { onClose: () => void }) {
  const { settings } = useStore();
  // app tiles: first choose the app
  const [picking, setPicking] = useState(false);
  if (picking)
    return (
      <AppPicker
        onClose={() => setPicking(false)}
        onPick={(app) => {
          addAppTile(app);
          onClose();
        }}
      />
    );
  return (
    <Modal onClose={onClose} layerClass="dash-gallery-backdrop" label={t('dashboard.gallery')}>
      <div className="dash-gallery">
        <div className="dash-gallery-head">
          <h2>{t('dashboard.gallery')}</h2>
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="dash-gallery-list">
          {WIDGETS.filter((d) => d.type !== 'timetable' || settings.schoolEnabled).map((d) => (
            <div key={d.type} className="dash-gallery-item">
              <span className="dash-gallery-icon">{d.icon}</span>
              <div className="dash-gallery-text">
                <strong>{d.title}</strong>
                <span className="muted">{d.description}</span>
              </div>
              <div className="dash-gallery-sizes">
                {d.sizes.map((s) => (
                  <button
                    key={s}
                    className="dash-size-btn"
                    title={SIZES[s].label}
                    onClick={() => {
                      if (d.type === 'app') return setPicking(true);
                      addWidget(d.type, s);
                      onClose();
                    }}
                  >
                    <SizeGlyph size={s} />
                    <span>
                      {SIZES[s].w}×{SIZES[s].h}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
