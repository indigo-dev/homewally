import { memo, useMemo } from 'react';
import { useStore } from '../store';
import { addDays, AGENDA_DAYS, dayKey, fmt, fmtTime, isSameDay, startOfDay } from '../lib/dates';
import type { CalEvent } from '../types';
import { AvatarStack } from '../components/Avatar';
import { LocalMark } from '../components/Icon';
import { membersOf, stripe, type ViewProps } from './common';
import { t, useLanguage } from '../i18n';

// Re-renders only when its inputs change (the clock ticks every 30 s).
export const AgendaView = memo(function AgendaView({ date, now, events, onEvent, onOpen, marks }: ViewProps) {
  const { memberById } = useStore();
  useLanguage(); // memo: re-render on a language change, too
  const todayKey = dayKey(now);

  // One pass over the events, bucketed by day (instead of filtering all events for every day).
  const groups = useMemo(() => {
    const start = startOfDay(date);
    const end = addDays(start, AGENDA_DAYS);
    const buckets = new Map<string, CalEvent[]>();
    for (const e of events) {
      let d = e.start > start ? startOfDay(e.start) : start;
      for (; d < e.end && d < end; d = addDays(d, 1)) {
        const k = dayKey(d);
        const list = buckets.get(k);
        if (list) list.push(e);
        else buckets.set(k, [e]);
      }
    }
    return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(start, i))
      .map((d) => ({ d, list: buckets.get(dayKey(d)) ?? [] }))
      .filter((g) => g.list.length > 0 || dayKey(g.d) === todayKey || !!marks.get(dayKey(g.d))?.publicNames.length);
  }, [date, events, todayKey, marks]);

  return (
    <div className="agenda">
      {groups.length === 0 && <p className="empty">{t('calendar.noEventsRange')}</p>}
      {groups.map(({ d, list }) => {
        const today = isSameDay(d, now);
        const tomorrow = isSameDay(d, addDays(startOfDay(now), 1));
        const mk = marks.get(dayKey(d));
        const label = [...(mk?.publicNames ?? []), ...(mk?.schoolNames ?? [])].join(' · ');
        return (
          <section key={d.toISOString()} className={`agenda-day ${today ? 'today' : ''}`}>
            <button className="agenda-date" onClick={() => onOpen('day', d)}>
              <span className="agenda-dn">{d.getDate()}</span>
              <span className="agenda-wd">
                {today ? t('common.today') : tomorrow ? t('common.tomorrow') : fmt(d, { weekday: 'long' })}
                <small>{fmt(d, { month: 'long', year: 'numeric' })}</small>
                {label && <small className={`agenda-hol ${mk?.publicNames.length ? 'holiday' : 'school'}`}>{label}</small>}
              </span>
            </button>
            <div className="agenda-list">
              {list.length === 0 && <p className="muted">{t('calendar.noEvents')}</p>}
              {list.map((e) => {
                const ms = membersOf(e, memberById);
                const past = !e.allDay && e.end < now;
                return (
                  <button key={e.key} className={`agenda-item ${past ? 'past' : ''}`} onClick={() => onEvent(e)}>
                    <span className="agenda-time">
                      {e.allDay ? (
                        t('common.allDay')
                      ) : (
                        <>
                          {fmtTime(e.start)}
                          <small>{fmtTime(e.end)}</small>
                        </>
                      )}
                    </span>
                    <span className="ev-stripe" style={{ background: stripe(ms) }} />
                    <span className="agenda-text">
                      <span className="ev-title">
                        {e.localId && <LocalMark title={t('calendar.local.badge')} />}
                        {e.title}
                      </span>
                      {e.location && <span className="muted small">📍 {e.location}</span>}
                    </span>
                    <AvatarStack members={ms} size={30} />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
});
