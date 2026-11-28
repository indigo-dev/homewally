import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { persisted } from '../lib/persisted';
import type { CalEvent } from '../types';
import { useStore } from '../store';
import { addDays, dayKey, fmt, fmtClock, fmtTime, isSameDay, overlaps, startOfDay, startOfWeek } from '../lib/dates';
import { t } from '../i18n';
import { useSize } from '../lib/hooks';
import { AvatarStack } from '../components/Avatar';
import { LocalMark } from '../components/Icon';
import { markClass, membersOf, stripe, tint, type ViewProps } from './common';
import { AllDayChip } from './AllDayChip';
import { deg, describe, useHomeDays, type Day } from '../lib/weather';
import { WxIcon } from '../weather/WxIcon';

/** Forecast of the home place in a day column header: icon + max / min. */
function DayWeather({ day }: { day?: Day }) {
  if (!day) return null;
  const w = describe(day.code);
  return (
    <span className="tg-wx" title={t('calendar.rainTitle', { text: w.text, max: deg(day.max), min: deg(day.min), rain: day.rainProb })}>
      <WxIcon code={day.code} title="" /> <b>{deg(day.max)}</b> {deg(day.min)}
    </span>
  );
}

interface Placed {
  e: CalEvent;
  top: number; // minutes from window start
  bottom: number;
  col: number;
  cols: number;
}

const MIN_DURATION = 25;
/** px per hour chosen by pinching; stored per device */
const ZOOM_KEY = 'fc.hourHeight';
const MAX_HOUR = 280;
const MIN_EVENT_PX = 16;

const zoomStore = persisted<number | null>(ZOOM_KEY, (raw) => (typeof raw === 'number' && raw > 0 ? raw : null));
const loadZoom = () => zoomStore.get();
const saveZoom = (v: number) => zoomStore.set(Math.round(v));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Grid line step in minutes at a given hour height. */
function lineStep(h: number): number {
  return h >= 200 ? 15 : h >= 90 ? 30 : 60;
}
/** Time label step in minutes at a given hour height. */
function labelStep(h: number): number {
  return h >= 240 ? 15 : h >= 110 ? 30 : h < 22 ? 120 : 60;
}

interface Pinch {
  x0: number;
  y0: number;
  h0: number;
  n0: number;
  axis: 'x' | 'y' | null;
  /** minute under the fingers when the pinch started */
  minute0: number;
  /** horizontal finger position across the day columns, 0..1 */
  frac: number;
  focalDay: Date;
  lastN: number;
}

function layoutDay(events: CalEvent[], winStart: Date, winEnd: Date): Placed[] {
  const total = (winEnd.getTime() - winStart.getTime()) / 60000;
  const items = events
    .map((e) => {
      let top = (e.start.getTime() - winStart.getTime()) / 60000;
      let bottom = (e.end.getTime() - winStart.getTime()) / 60000;
      top = Math.max(0, Math.min(top, total - MIN_DURATION));
      bottom = Math.min(total, Math.max(bottom, top + MIN_DURATION));
      return { e, top, bottom, col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  let cluster: Placed[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const p of items) {
    if (p.top >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= p.top);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(p.bottom);
    } else colEnds[col] = p.bottom;
    p.col = col;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.bottom);
  }
  flush();
  return items;
}

interface Props extends ViewProps {
  /** number of day columns, 1–7; 7 = calendar week */
  days: number;
  /** pinch sideways: new number of days and the first day to show */
  onDayCount?: (n: number, start: Date) => void;
}

export function TimeGridView({ date, now, events, onEvent, onOpen, marks, days, onDayCount }: Props) {
  const { settings, memberById } = useStore();
  const wx = useHomeDays();
  const first = days === 7 ? startOfWeek(date, settings.weekStartsOn) : startOfDay(date);
  const dayList = Array.from({ length: days }, (_, i) => addDays(first, i));
  const h0 = settings.dayStartHour;
  const h1 = Math.max(settings.dayEndHour, h0 + 1);
  const hours = h1 - h0;

  const [bodyRef, size] = useSize<HTMLDivElement>();
  const fit = size.height > 0 ? size.height / hours : 0;
  const auto = Math.max(40, Math.floor(fit) || 52);
  // zooming out stops when the whole day fits on screen
  const minH = fit > 0 ? Math.min(fit, auto) : 20;
  const [zoom, setZoom] = useState<number | null>(loadZoom);
  const hourHeight = zoom == null ? auto : clamp(zoom, minH, MAX_HOUR);
  const pxPerMin = hourHeight / 60;
  const scrollRef = bodyRef;
  const rootRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);
  const pendingScroll = useRef<number | null>(null);

  // When the grid is taller than the screen, scroll to the current hour once.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || didScroll.current || size.height === 0) return;
    didScroll.current = true;
    const target = (now.getHours() - h0 - 1) * hourHeight;
    if (target > 0) el.scrollTop = target;
  }, [size.height, hourHeight, h0, now, scrollRef]);

  // keep the time under the fingers in place while zooming
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pendingScroll.current != null) el.scrollTop = pendingScroll.current;
    pendingScroll.current = null;
  }, [hourHeight, scrollRef]);

  // latest values for the native gesture listeners
  const live = useRef({ hourHeight, minH, days, first, onDayCount });
  useLayoutEffect(() => {
    live.current = { hourHeight, minH, days, first, onDayCount };
  });

  // Pinch up/down = finer or coarser hour grid, pinch sideways = number of days (1 … 7).
  // Ctrl + wheel (trackpad pinch on desktop) zooms the hour grid.
  useEffect(() => {
    const root = rootRef.current;
    const body = scrollRef.current;
    if (!root || !body) return;
    let g: Pinch | null = null;

    const zoomTo = (h: number, minute: number, clientY: number) => {
      const next = clamp(h, live.current.minH, MAX_HOUR);
      pendingScroll.current = minute * next - (clientY - body.getBoundingClientRect().top);
      setZoom(next);
      return next;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        g = null;
        return;
      }
      const [a, b] = [e.touches[0], e.touches[1]];
      const L = live.current;
      const rect = body.getBoundingClientRect();
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const left = body.querySelector('.tg-col')?.getBoundingClientRect().left ?? rect.left;
      const frac = clamp((midX - left) / Math.max(1, rect.right - left), 0, 0.999);
      g = {
        x0: Math.abs(a.clientX - b.clientX),
        y0: Math.abs(a.clientY - b.clientY),
        h0: L.hourHeight,
        n0: L.days,
        axis: null,
        minute0: (body.scrollTop + midY - rect.top) / L.hourHeight,
        frac,
        focalDay: addDays(L.first, Math.floor(frac * L.days)),
        lastN: L.days,
      };
    };

    const onMove = (e: TouchEvent) => {
      if (!g || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dx = Math.abs(a.clientX - b.clientX);
      const dy = Math.abs(a.clientY - b.clientY);
      if (!g.axis) {
        const cx = Math.abs(dx - g.x0);
        const cy = Math.abs(dy - g.y0);
        if (Math.max(cx, cy) < 14) return;
        g.axis = cy >= cx ? 'y' : 'x';
      }
      if (g.axis === 'y') {
        zoomTo((g.h0 * Math.max(dy, 40)) / Math.max(g.y0, 40), g.minute0, (a.clientY + b.clientY) / 2);
        return;
      }
      const L = live.current;
      if (!L.onDayCount) return;
      const n = clamp(Math.round((g.n0 * Math.max(g.x0, 40)) / Math.max(dx, 40)), 1, 7);
      if (n === g.lastN) return;
      g.lastN = n;
      // keep the day under the fingers at about the same place
      const start = n === 7 ? g.focalDay : addDays(g.focalDay, -Math.min(n - 1, Math.floor(g.frac * n)));
      L.onDayCount(n, start);
    };

    const onEnd = (e: TouchEvent) => {
      if (!g || e.touches.length >= 2) return;
      if (g.axis === 'y') saveZoom(live.current.hourHeight);
      g = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const h = live.current.hourHeight;
      const minute = (body.scrollTop + e.clientY - body.getBoundingClientRect().top) / h;
      // trackpad pinch sends small deltas, a mouse wheel notch ~100 → cap per event
      saveZoom(zoomTo(h * Math.exp(-clamp(e.deltaY, -40, 40) * 0.008), minute, e.clientY));
    };

    // iOS Safari: suppress its own page zoom gesture
    const stop = (e: Event) => e.preventDefault();

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('gesturestart', stop);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('gesturestart', stop);
    };
  }, [scrollRef]);

  const lStep = lineStep(hourHeight);
  const lines = Array.from({ length: (hours * 60) / lStep }, (_, i) => i * lStep);
  const tStep = labelStep(hourHeight);
  const labels = Array.from({ length: Math.ceil((hours * 60) / tStep) }, (_, i) => i * tStep).filter((m) => m > 0);
  const hm = (min: number) => fmtClock(h0 + Math.floor(min / 60), min % 60);

  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);
  const hasAllDay = dayList.some((d) => allDay.some((e) => overlaps(e.start, e.end, d, addDays(d, 1))));

  return (
    <div className={`timegrid days-${days}`} ref={rootRef}>
      <div className="tg-head">
        <div className="tg-gutter" />
        {dayList.map((d) => {
          const today = isSameDay(d, now);
          const mk = marks.get(dayKey(d));
          const label = [...(mk?.publicNames ?? []), ...(mk?.schoolNames ?? [])].join(' · ');
          return (
            <button
              key={d.toISOString()}
              className={`tg-dayhead ${today ? 'today' : ''} ${markClass(mk)}`}
              onClick={() => days > 1 && onOpen('day', d)}
            >
              <span className="tg-wd">{fmt(d, { weekday: days === 1 ? 'long' : 'short' })}</span>
              <span className="tg-dn">{d.getDate()}</span>
              <DayWeather day={wx.get(dayKey(d))} />

              {label && (
                <span className="tg-hol" title={label}>
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {hasAllDay && (
        <div className="tg-allday">
          <div className="tg-gutter small muted">{t('common.allDay')}</div>
          {dayList.map((d) => {
            const list = allDay.filter((e) => overlaps(e.start, e.end, d, addDays(d, 1)));
            return (
              <div key={d.toISOString()} className="tg-allday-cell">
                {list.slice(0, 3).map((e) => {
                  const ms = membersOf(e, memberById);
                  return <AllDayChip key={e.key} e={e} members={ms} onClick={() => onEvent(e)} />;
                })}
                {list.length > 3 && (
                  <button className="more" onClick={() => onOpen('day', d)}>
                    +{list.length - 3} weitere
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="tg-body" ref={bodyRef}>
        <div className="tg-inner" style={{ height: hours * hourHeight }}>
          <div className="tg-gutter tg-hours">
            {labels.map((m) => (
              <div key={m} className={`tg-hour-label ${m % 60 ? 'sub' : ''}`} style={{ top: m * pxPerMin }}>
                {hm(m)}
              </div>
            ))}
          </div>
          {dayList.map((d) => {
            const winStart = new Date(d);
            winStart.setHours(h0, 0, 0, 0);
            const winEnd = new Date(d);
            winEnd.setHours(h1, 0, 0, 0);
            const dayEvents = timed.filter((e) => overlaps(e.start, e.end, startOfDay(d), addDays(startOfDay(d), 1)));
            const placed = layoutDay(dayEvents, winStart, winEnd);
            const isToday = isSameDay(d, now);
            const nowMin = (now.getTime() - winStart.getTime()) / 60000;
            return (
              <div key={d.toISOString()} className={`tg-col ${isToday ? 'today' : ''} ${markClass(marks.get(dayKey(d)))}`}>
                {lines.map((m) => (
                  <div key={m} className={`tg-line ${m % 60 ? 'sub' : ''}`} style={{ top: m * pxPerMin }} />
                ))}
                {placed.map(({ e, top, bottom, col, cols }) => {
                  const ms = membersOf(e, memberById);
                  const height = Math.max(MIN_EVENT_PX, (bottom - top) * pxPerMin - 2);
                  const compact = height < 40;
                  return (
                    <button
                      key={e.key}
                      className={`tg-event ${compact ? 'compact' : ''}`}
                      style={{
                        top: top * pxPerMin + 1,
                        height,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - 4px)`,
                        background: tint(ms[0]?.color ?? '#888'),
                      }}
                      onClick={() => onEvent(e)}
                    >
                      <span className="ev-stripe" style={{ background: stripe(ms) }} />
                      <span className="ev-body">
                        <span className="ev-title">
                          {e.localId && <LocalMark title={t('calendar.local.badge')} />}
                          {e.title}
                        </span>
                        {!compact && (
                          <span className="ev-time">
                            {fmtTime(e.start)} – {fmtTime(e.end)}
                            {e.location ? ` · ${e.location}` : ''}
                          </span>
                        )}
                      </span>
                      {!compact && days === 1 && <AvatarStack members={ms} size={24} />}
                      {!compact && days > 1 && ms.length > 1 && <AvatarStack members={ms} size={18} />}
                    </button>
                  );
                })}
                {isToday && nowMin >= 0 && nowMin <= hours * 60 && <div className="tg-now" style={{ top: nowMin * pxPerMin }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
