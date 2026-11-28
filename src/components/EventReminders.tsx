import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalEvent, Member } from '../types';
import { useStore } from '../store';
import { proxyOf, useEvents } from '../lib/events';
import { addDays, fmtTime, startOfDay } from '../lib/dates';
import { useMinute, useToday } from '../lib/clock';
import { isQuietTime, playSound, useSoundSettings } from '../lib/sounds';
import { speak } from '../native/speech';
import { AvatarStack } from './Avatar';
import { LocalMark } from './Icon';
import { t } from '../i18n';

const SEEN_KEY = 'fc.reminded';
/** how long a reminder banner stays visible if nobody taps OK */
const AUTO_DISMISS_MS = 120_000;

function readSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeSeen(set: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-80)));
  } catch {
    /* ignore */
  }
}

/** Timed events that have entered the reminder window `[start - lead, start + 1 min]` and have not been shown yet. */
export function dueReminders(events: CalEvent[], now: Date, leadMinutes: number, seen: ReadonlySet<string>): CalEvent[] {
  const nowMs = now.getTime();
  return events.filter((e) => {
    if (e.allDay || seen.has(e.key)) return false;
    const minsLeft = Math.round((e.start.getTime() - nowMs) / 60_000);
    return minsLeft <= leadMinutes && minsLeft >= -1;
  });
}

function formatLead(minsLeft: number): string {
  if (minsLeft <= 0) return t('reminders.now');
  return t('reminders.inMinutes', { n: minsLeft });
}

function spokenReminder(e: CalEvent, minsLeft: number, memberNames: string[], totalMembers: number): string {
  const who =
    memberNames.length > 0 && memberNames.length < totalMembers
      ? t('reminders.forWhom', {
          names:
            memberNames.length === 1
              ? memberNames[0]
              : `${memberNames.slice(0, -1).join(', ')} ${t('voice.and')} ${memberNames[memberNames.length - 1]}`,
        })
      : '';
  if (minsLeft <= 0) return t('reminders.speakNow', { title: e.title, who });
  return t('reminders.speakIn', { n: minsLeft, title: e.title, who });
}

/**
 * Watches upcoming timed calendar events (subscribed + local) and displays a calm visual banner,
 * optional chime, and optional spoken announcement. Mounted globally so it also works over the photo frame.
 */
export function EventReminders() {
  const sound = useSoundSettings();
  const { members, calendars, settings, memberById } = useStore();
  const now = useMinute();
  const today = useToday();
  const range = useMemo(() => {
    const start = startOfDay(today);
    return { start, end: addDays(start, 2) };
  }, [today]);
  const { events } = useEvents(range, members, calendars, proxyOf(settings), 0);
  const seenRef = useRef<Set<string> | null>(null);
  const [active, setActive] = useState<CalEvent[]>([]);

  useEffect(() => {
    if (!sound.remindersEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive((cur) => (cur.length ? [] : cur));
      return;
    }
    if (!seenRef.current) seenRef.current = readSeen();
    const seen = seenRef.current;
    const due = dueReminders(events, now, sound.reminderMinutes, seen);
    if (due.length === 0) return;

    due.forEach((e) => seen.add(e.key));
    writeSeen(seen);

    setActive((cur) => {
      const existing = new Set(cur.map((x) => x.key));
      return [...cur, ...due.filter((e) => !existing.has(e.key))];
    });

    const quiet = isQuietTime(sound, now);
    const playedChime = sound.enabled && sound.reminderSound && !quiet;
    if (playedChime) playSound('reminder', { now });

    if (sound.reminderSpeak && !quiet) {
      const lines = due.map((e) => {
        const minsLeft = Math.round((e.start.getTime() - now.getTime()) / 60_000);
        const names = e.memberIds.map((id) => memberById.get(id)?.name).filter((n): n is string => !!n);
        return spokenReminder(e, minsLeft, names, members.length);
      });
      const text = lines.join(' ');
      if (playedChime) window.setTimeout(() => void speak(text), 480);
      else void speak(text);
    }
  }, [events, now, sound, memberById, members.length]);

  // auto-dismiss banners after 2 minutes so the wall display stays clean
  useEffect(() => {
    if (active.length === 0) return;
    const timer = window.setTimeout(() => setActive([]), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (active.length === 0) return null;

  const dismiss = (key: string) => setActive((cur) => cur.filter((x) => x.key !== key));

  return (
    <div className="reminder-stack" role="region" aria-live="polite" aria-label={t('reminders.region')}>
      {active.map((e) => {
        const ms = e.memberIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m);
        const minsLeft = Math.round((e.start.getTime() - now.getTime()) / 60_000);
        return (
          <div key={e.key} className="reminder-banner" role="status">
            <span className="reminder-bar" style={{ background: ms[0]?.color ?? 'var(--accent)' }} />
            <div className="reminder-body">
              <div className="reminder-meta">
                <span className="reminder-when">{formatLead(minsLeft)}</span>
                <span className="muted">· {fmtTime(e.start)}</span>
                {e.location && <span className="muted">· 📍 {e.location}</span>}
              </div>
              <strong className="reminder-title">
                {e.localId && <LocalMark title={t('calendar.local.badge')} />}
                {e.title}
              </strong>
            </div>
            {ms.length > 0 && <AvatarStack members={ms} size={28} />}
            <button className="btn primary reminder-ok" onClick={() => dismiss(e.key)}>
              {t('reminders.ok')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
