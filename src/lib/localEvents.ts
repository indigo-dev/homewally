import type { CalEvent, DateRange } from '../types';
import { addDays, startOfDay } from './dates';
import { uid } from './id';
import { arrayOf, isRecord, isString, oneOf, persisted, usePersisted } from './persisted';
import { t } from '../i18n';

const KEY = 'fc.localEvents';

export type Recurrence = 'none' | 'weekly' | 'monthly' | 'yearly';
export const RECURRENCES: readonly Recurrence[] = ['none', 'weekly', 'monthly', 'yearly'];

/**
 * An event created directly inside HomeWally ("local family calendar").
 * Stored only on this device (included in JSON export/import, never synced to Google/iCloud).
 */
export interface LocalEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD (inclusive start date) */
  date: string;
  /** YYYY-MM-DD (inclusive end date for multi-day all-day events) */
  endDate?: string;
  allDay: boolean;
  /** HH:MM when allDay is false */
  startTime?: string;
  /** HH:MM when allDay is false */
  endTime?: string;
  repeat: Recurrence;
  /** family members this event belongs to */
  memberIds: string[];
  location?: string;
  notes?: string;
  /** epoch ms */
  createdAt: number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;

const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(parseYmd(v).getTime());
const isHm = (v: unknown): v is string => {
  if (typeof v !== 'string' || !HM.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
};

/** Parses YYYY-MM-DD into local midnight. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Formats a local Date as YYYY-MM-DD. */
export function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseLocalEvent(raw: unknown): LocalEvent | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title || !isYmd(raw.date)) return null;
  const allDay = raw.allDay !== false;
  const endDate = allDay && isYmd(raw.endDate) && raw.endDate > raw.date ? raw.endDate : undefined;
  const startTime = !allDay && isHm(raw.startTime) ? raw.startTime : !allDay ? '09:00' : undefined;
  const endTime = !allDay && isHm(raw.endTime) ? raw.endTime : undefined;
  return {
    id: raw.id,
    title,
    date: raw.date,
    endDate,
    allDay,
    startTime,
    endTime,
    repeat: oneOf(raw.repeat, RECURRENCES, 'none'),
    memberIds: arrayOf(raw.memberIds, isString),
    location: typeof raw.location === 'string' && raw.location.trim() ? raw.location.trim() : undefined,
    notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : undefined,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  };
}

function parseList(raw: unknown): LocalEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseLocalEvent).filter((e): e is LocalEvent => !!e);
}

export const localEvents = persisted<LocalEvent[]>(KEY, parseList);

export function newLocalEvent(memberIds: string[], date = toYmd(new Date())): LocalEvent {
  return {
    id: uid(),
    title: '',
    date,
    allDay: true,
    repeat: 'none',
    memberIds,
    createdAt: Date.now(),
  };
}

export function upsertLocalEvent(ev: LocalEvent): void {
  localEvents.set((cur) => (cur.some((x) => x.id === ev.id) ? cur.map((x) => (x.id === ev.id ? ev : x)) : [...cur, ev]));
}

export function removeLocalEvent(id: string): void {
  localEvents.set((cur) => cur.filter((x) => x.id !== id));
}

export function clearLocalEvents(): void {
  localEvents.set([]);
}

/** Removes a deleted family member from local events; drops events that belonged solely to them. */
export function pruneLocalEventsMember(memberId: string): void {
  localEvents.set((cur) =>
    cur.map((e) => ({ ...e, memberIds: e.memberIds.filter((id) => id !== memberId) })).filter((e) => e.memberIds.length > 0),
  );
}

export function useLocalEvents() {
  return {
    events: usePersisted(localEvents),
    upsert: upsertLocalEvent,
    remove: removeLocalEvent,
    clear: clearLocalEvents,
  };
}

/* ------------------------------------------------------------------ expansion into CalEvent[] */

const DAY_MS = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / DAY_MS);
}

/** Builds start/end Dates for one occurrence starting on local day `day`. */
function boundsFor(ev: LocalEvent, day: Date, spanDays: number): { start: Date; end: Date } {
  if (ev.allDay) {
    const start = startOfDay(day);
    return { start, end: addDays(start, Math.max(1, spanDays)) };
  }
  const [sh, sm] = (ev.startTime ?? '09:00').split(':').map(Number);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm);
  let end: Date;
  if (ev.endTime && isHm(ev.endTime)) {
    const [eh, em] = ev.endTime.split(':').map(Number);
    end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em);
    if (end <= start) end = new Date(start.getTime() + 60 * 60_000);
  } else {
    end = new Date(start.getTime() + 60 * 60_000);
  }
  return { start, end };
}

/** Clamps a day-of-month to the target month's length (e.g. Jan 31 → Feb 28/29). */
function clampedDate(year: number, monthIndex: number, dayOfMonth: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(dayOfMonth, lastDay));
}

/** Expands local events (including weekly/monthly/yearly repeats) into CalEvents overlapping `range`. */
export function expandLocalEvents(items: LocalEvent[], range: DateRange, validMemberIds?: Set<string>): CalEvent[] {
  const out: CalEvent[] = [];
  const calName = t('calendar.local.sourceName');

  for (const ev of items) {
    const memberIds = validMemberIds ? ev.memberIds.filter((id) => validMemberIds.has(id)) : [...ev.memberIds];
    if (memberIds.length === 0) continue;

    const base = parseYmd(ev.date);
    const spanDays = ev.allDay && ev.endDate && ev.endDate > ev.date ? daysBetween(base, parseYmd(ev.endDate)) + 1 : 1;

    const push = (day: Date) => {
      const { start, end } = boundsFor(ev, day, spanDays);
      if (end <= range.start || start >= range.end) return;
      out.push({
        key: `local:${ev.id}|${start.getTime()}`,
        localId: ev.id,
        title: ev.title,
        start,
        end,
        allDay: ev.allDay,
        location: ev.location,
        notes: ev.notes,
        calendarName: calName,
        memberIds: [...memberIds],
      });
    };

    if (ev.repeat === 'none') {
      push(base);
      continue;
    }

    if (ev.repeat === 'weekly') {
      const diff = daysBetween(base, range.start) - spanDays;
      let k = diff > 0 ? Math.floor(diff / 7) : 0;
      for (let guard = 0; guard < 1000; guard++, k++) {
        const day = addDays(base, k * 7);
        if (day >= range.end) break;
        push(day);
      }
      continue;
    }

    if (ev.repeat === 'monthly') {
      const baseMonths = base.getFullYear() * 12 + base.getMonth();
      const startMonths = range.start.getFullYear() * 12 + range.start.getMonth() - 1;
      let m = Math.max(0, startMonths - baseMonths);
      for (let guard = 0; guard < 1000; guard++, m++) {
        const total = baseMonths + m;
        const day = clampedDate(Math.floor(total / 12), total % 12, base.getDate());
        if (day >= range.end) break;
        push(day);
      }
      continue;
    }

    if (ev.repeat === 'yearly') {
      let y = Math.max(base.getFullYear(), range.start.getFullYear() - 1);
      for (let guard = 0; guard < 200; guard++, y++) {
        const day = clampedDate(y, base.getMonth(), base.getDate());
        if (day >= range.end) break;
        push(day);
      }
    }
  }

  return out;
}
