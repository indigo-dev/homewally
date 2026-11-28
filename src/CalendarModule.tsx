import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { softly } from './lib/transition';
import type { CalEvent, ViewMode } from './types';
import { useStore } from './store';
import { rangeFor, startOfDay, stepDate, titleFor } from './lib/dates';
import { proxyOf, useEvents } from './lib/events';
import { newLocalEvent, toYmd, useLocalEvents, type LocalEvent } from './lib/localEvents';
import { playSound } from './lib/sounds';
import { useHolidayMarks } from './lib/holidays';
import { clampDays } from './lib/config';
import { useSwipe } from './lib/hooks';
import { Header, MemberFilter } from './components/Header';
import { EventDetail } from './components/EventDetail';
import { EventEditor } from './components/EventEditor';
import { TimeGridView } from './views/TimeGridView';
import { MonthView } from './views/MonthView';
import { YearView } from './views/YearView';
import { AgendaView } from './views/AgendaView';
import { onMinute, useMinute, useToday } from './lib/clock';
import { onCalendarRequest } from './lib/calendarNav';
import { fmtTime } from './lib/dates';
import { t } from './i18n';

interface Props {
  /** changes when the settings panel closes -> reload calendars */
  reloadKey: number;
  settingsOpen: boolean;
  onSettings: () => void;
  onWeather: () => void;
}

export function CalendarModule({ reloadKey, settingsOpen, onSettings, onWeather }: Props) {
  const { settings, updateSettings, members, calendars, selectedIds, memberById } = useStore();
  const { events: localList, upsert: upsertLocal, remove: removeLocal } = useLocalEvents();
  const nDays = settings.multiDays;
  const [view, setView] = useState<ViewMode>(settings.defaultView);
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [editingLocal, setEditingLocal] = useState<{ ev: LocalEvent; isNew: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [banner, setBanner] = useState<string | undefined>();
  const [mountedAt] = useState(Date.now);
  const lastInteraction = useRef(mountedAt);

  const firstReload = useRef(true);
  useEffect(() => {
    if (firstReload.current) firstReload.current = false;
    else setNonce((n) => n + 1);
  }, [reloadKey]);

  const range = useMemo(() => rangeFor(view, date, settings.weekStartsOn, nDays), [view, date, settings.weekStartsOn, nDays]);
  const { events, loading, status, lastUpdated } = useEvents(range, members, calendars, proxyOf(settings), nonce);
  const { marks } = useHolidayMarks(range, settings.holidays);

  // calendar problems shown at the person: memberId -> message
  const memberIssues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of calendars) {
      const st = status[c.id];
      if (!st || st.state === 'ok') continue;
      for (const id of c.memberIds) out[id] = (out[id] ? out[id] + '\n' : '') + `${c.name}: ${st.message}`;
    }
    return out;
  }, [calendars, status]);

  // periodic refresh + refresh when the app comes back to the foreground
  useEffect(() => {
    const t = setInterval(() => setNonce((n) => n + 1), settings.refreshMinutes * 60_000);
    const onVis = () => document.visibilityState === 'visible' && setNonce((n) => n + 1);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [settings.refreshMinutes]);

  // after inactivity jump back to the default view / today (wall display mode)
  useEffect(() => {
    const mark = () => (lastInteraction.current = Date.now());
    window.addEventListener('pointerdown', mark, { passive: true });
    window.addEventListener('keydown', mark);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, []);
  useEffect(
    () =>
      onMinute(() => {
        if (!settings.idleResetMinutes || settingsOpen) return;
        if (Date.now() - lastInteraction.current < settings.idleResetMinutes * 60_000) return;
        setSelected(null);
        setView(settings.defaultView);
        setDate(startOfDay(new Date()));
      }),
    [settings.idleResetMinutes, settings.defaultView, settingsOpen],
  );

  // the voice control: "geh in die Wochenansicht", "zeig mir den nächsten Monat"
  useEffect(
    () =>
      onCalendarRequest((r) => {
        lastInteraction.current = Date.now();
        softly(() => {
          setSelected(null);
          if (r.view) setView(r.view);
          if (r.date) setDate(startOfDay(r.date));
        });
      }),
    [],
  );

  // date rollover at midnight: keep "today" current if the user is looking at today
  const today = useToday();
  const prevDay = useRef(today.getTime());
  useEffect(() => {
    if (today.getTime() === prevDay.current) return;
    setDate((d) => (d.getTime() === prevDay.current ? today : d));
    prevDay.current = today.getTime();
    setNonce((n) => n + 1);
  }, [today]);
  // the views show the current time (now line, past events)
  const now = useMinute();
  const step = useCallback((dir: 1 | -1) => softly(() => setDate((d) => stepDate(view, d, dir, nDays)), { dir, axis: 'x' }), [view, nDays]);
  const swipe = useSwipe(step);
  const open = useCallback((v: ViewMode, d: Date) => {
    softly(() => {
      setView(v);
      setDate(startOfDay(d));
    });
  }, []);

  const visible = useMemo(
    () =>
      events
        .map((e) => ({ ...e, memberIds: e.memberIds.filter((id) => memberById.has(id)) }))
        .filter((e) => (selectedIds.size > 0 ? e.memberIds.some((id) => selectedIds.has(id)) : e.memberIds.length > 0)),
    [events, selectedIds, memberById],
  );

  /** Pinch / stepper: 1 day = day view, 2–6 = N-days view, 7 = week view; `start` = first visible day. */
  const setDayCount = useCallback(
    (n: number, start?: Date) => {
      if (start) setDate(startOfDay(start));
      if (n <= 1) setView('day');
      else if (n >= 7) setView('week');
      else {
        setView('days');
        if (n !== nDays) updateSettings({ multiDays: clampDays(n) });
      }
    },
    [nDays, updateSettings],
  );

  // is today on screen? (month: the month itself, not the leading/trailing days of the grid)
  const today0 = startOfDay(now);
  const showsToday =
    view === 'month'
      ? date.getFullYear() === today0.getFullYear() && date.getMonth() === today0.getMonth()
      : view === 'year'
        ? date.getFullYear() === today0.getFullYear()
        : (() => {
            const r = rangeFor(view, date, settings.weekStartsOn, nDays);
            return today0 >= r.start && today0 < r.end;
          })();

  const viewProps = { date, now, events: visible, onEvent: setSelected, onOpen: open, marks };

  return (
    <>
      <Header
        title={titleFor(view, date, settings.weekStartsOn, nDays)}
        view={view}
        multiDays={nDays}
        onMultiDays={(n) => setDayCount(n)}
        loading={loading}
        onView={(v) => v !== view && softly(() => setView(v))}
        onStep={step}
        onToday={() => {
          const today = startOfDay(new Date());
          softly(() => setDate(today), { dir: date < today ? 1 : -1, axis: 'x' });
        }}
        onRefresh={() => setNonce((n) => n + 1)}
        onSettings={onSettings}
        onWeather={onWeather}
        onAddEvent={
          settings.localCalendarEnabled && members.length > 0
            ? () => {
                const who = selectedIds.size > 0 ? [...selectedIds] : members.map((m) => m.id);
                setEditingLocal({ ev: newLocalEvent(who, toYmd(date)), isNew: true });
              }
            : undefined
        }
        filter={<MemberFilter issues={memberIssues} onIssue={setBanner} />}
        away={!showsToday}
      />
      {banner && (
        <div className="banner error" onClick={() => setBanner(undefined)}>
          {banner} <span className="muted">{t('common.tapToClose')}</span>
        </div>
      )}{' '}
      <main className="view" data-vt-section {...swipe}>
        {/* one slot for all time-grid views so a pinch gesture survives switching between them */}
        {(view === 'day' || view === 'days' || view === 'week') && (
          <TimeGridView {...viewProps} days={view === 'day' ? 1 : view === 'week' ? 7 : nDays} onDayCount={setDayCount} />
        )}
        {view === 'month' && <MonthView {...viewProps} />}
        {view === 'year' && <YearView {...viewProps} />}
        {view === 'agenda' && <AgendaView {...viewProps} />}
      </main>
      {lastUpdated && <div className="statusline muted">{t('calendar.updated', { time: fmtTime(lastUpdated) })}</div>}
      {selected && (
        <EventDetail
          event={selected}
          onClose={() => setSelected(null)}
          onEdit={(id) => {
            const found = localList.find((x) => x.id === id);
            setSelected(null);
            if (found) setEditingLocal({ ev: found, isNew: false });
          }}
          onDelete={(id) => {
            removeLocal(id);
            setSelected(null);
          }}
        />
      )}
      {editingLocal && (
        <EventEditor
          initial={editingLocal.ev}
          isNew={editingLocal.isNew}
          onSave={(ev) => {
            upsertLocal(ev);
            playSound('eventSaved');
            setEditingLocal(null);
          }}
          onDelete={
            editingLocal.isNew
              ? undefined
              : () => {
                  removeLocal(editingLocal.ev.id);
                  setEditingLocal(null);
                }
          }
          onClose={() => setEditingLocal(null)}
        />
      )}
    </>
  );
}
