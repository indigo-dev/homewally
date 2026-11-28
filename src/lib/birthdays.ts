import type { CalEvent, DateRange } from '../types';
import { addDays } from './dates';
import { uid } from './id';
import { isRecord, persisted, usePersisted } from './persisted';
import { t } from '../i18n';

const KEY = 'fc.birthdays';

/**
 * A birthday stored in HomeWally's local birthdays calendar.
 * Always all-day, repeats every year, not assigned to any family member, stored only on this device.
 */
export interface Birthday {
  id: string;
  name: string;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
  /** optional 4-digit birth year for automatic age display */
  year?: number;
  notes?: string;
  createdAt: number;
}

const maxDayForMonth = (month: number) => [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;

function parseBirthday(raw: unknown): Birthday | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const month = typeof raw.month === 'number' && Number.isInteger(raw.month) ? raw.month : 0;
  if (month < 1 || month > 12) return null;
  const day = typeof raw.day === 'number' && Number.isInteger(raw.day) ? raw.day : 0;
  if (day < 1 || day > maxDayForMonth(month)) return null;
  const year = typeof raw.year === 'number' && Number.isInteger(raw.year) && raw.year >= 1900 && raw.year <= 2100 ? raw.year : undefined;
  return {
    id: raw.id,
    name,
    month,
    day,
    year,
    notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : undefined,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  };
}

function parseList(raw: unknown): Birthday[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseBirthday).filter((b): b is Birthday => !!b);
}

export const birthdays = persisted<Birthday[]>(KEY, parseList);

export function newBirthday(date = new Date()): Birthday {
  return {
    id: uid(),
    name: '',
    month: date.getMonth() + 1,
    day: date.getDate(),
    createdAt: Date.now(),
  };
}

export function upsertBirthday(b: Birthday): void {
  birthdays.set((cur) => (cur.some((x) => x.id === b.id) ? cur.map((x) => (x.id === b.id ? b : x)) : [...cur, b]));
}

export function removeBirthday(id: string): void {
  birthdays.set((cur) => cur.filter((x) => x.id !== id));
}

export function clearBirthdays(): void {
  birthdays.set([]);
}

export function useBirthdays() {
  return {
    birthdays: usePersisted(birthdays),
    upsert: upsertBirthday,
    remove: removeBirthday,
    clear: clearBirthdays,
  };
}

/** Expands birthdays into yearly all-day CalEvents overlapping `range` (Feb 29 clamps to Feb 28 in non-leap years). */
export function expandBirthdays(items: Birthday[], range: DateRange): CalEvent[] {
  if (items.length === 0) return [];
  const out: CalEvent[] = [];
  const calName = t('calendar.birthdays.sourceName');
  const startYear = range.start.getFullYear() - 1;
  const endYear = range.end.getFullYear();

  for (const b of items) {
    for (let y = startYear; y <= endYear; y++) {
      const lastDay = new Date(y, b.month, 0).getDate();
      const start = new Date(y, b.month - 1, Math.min(b.day, lastDay));
      const end = addDays(start, 1);
      if (end <= range.start || start >= range.end) continue;
      const age = b.year !== undefined && y - b.year > 0 ? y - b.year : undefined;
      out.push({
        key: `bday:${b.id}|${y}`,
        birthdayId: b.id,
        birthdayAge: age,
        title:
          age !== undefined
            ? t('calendar.birthdays.eventTitleAge', { name: b.name, age })
            : t('calendar.birthdays.eventTitle', { name: b.name }),
        start,
        end,
        allDay: true,
        notes: b.notes,
        calendarName: calName,
        memberIds: [],
      });
    }
  }
  return out;
}
