import type { SymbolSet } from './lib/symbols';
import type { WeatherIconSet } from './lib/weatherIcons';
import type { LanguageSetting } from './i18n';

export type ViewMode = 'day' | 'days' | 'week' | 'month' | 'year' | 'agenda';

export type Avatar = { type: 'initials' } | { type: 'emoji'; value: string } | { type: 'image'; dataUrl: string };

export interface Member {
  id: string;
  name: string;
  color: string;
  avatar: Avatar;
  /** shows generated sample events for this person */
  demo?: boolean;
  /** school timetable; present = this person is a school child */
  timetable?: Timetable;
}

export type SchoolType = 'grundschule' | 'gymnasium';

/** One lesson slot, times as 'HH:MM' */
export interface Period {
  start: string;
  end: string;
}

export interface Timetable {
  schoolType: SchoolType;
  /** bell times; the number of entries is the number of lessons per day */
  periods: Period[];
  /** Mo..Fr (index 0..4) → subject id per lesson, null = free */
  cells: (string | null)[][];
}

export interface Subject {
  id: string;
  name: string;
  short: string;
  color: string;
}

/** Family-wide subject settings: changed colours of predefined subjects plus own subjects. */
export interface SchoolConfig {
  colors: Record<string, string>;
  custom: Subject[];
}

/** A calendar subscribed via its ICS link. It survives deleting a person. */
export interface CalendarSource {
  id: string;
  name: string;
  /** secret ICS subscription link (https:// or webcal://) */
  url: string;
  /** family members this calendar belongs to; empty = not shown */
  memberIds: string[];
  enabled: boolean;
}

/** German federal state code like 'DE-NW', '' = off */
export interface HolidaySettings {
  region: string;
  showPublic: boolean;
  showSchool: boolean;
}

export interface Settings {
  /** UI language; 'auto' = the device language */
  language: LanguageSetting;
  /** Cloudflare worker that fetches ICS links (CORS) */
  proxyUrl: string;
  /** access key of the worker (its ACCESS_KEY secret); empty = none */
  proxyKey: string;
  holidays: HolidaySettings;
  weekStartsOn: 0 | 1;
  dayStartHour: number;
  dayEndHour: number;
  defaultView: ViewMode;
  /** number of days in the 'days' view (2–6) */
  multiDays: number;
  refreshMinutes: number;
  idleResetMinutes: number;
  keepAwake: boolean;
  theme: 'auto' | 'light' | 'dark';
  /** visual style, independent of light/dark */
  style: UiStyle;
  /** how emoji symbols are drawn (shopping list, ...) */
  symbols: SymbolSet;
  /** how weather conditions are drawn */
  weatherIcons: WeatherIconSet;
  /** school area: timetables, bell times, subjects (off = hidden everywhere) */
  schoolEnabled: boolean;
  /** local family calendar (stored only on this device, not synced) */
  localCalendarEnabled: boolean;
  /** local birthdays calendar (all-day yearly events, unassigned, stored only on this device) */
  birthdaysCalendarEnabled: boolean;
}

export type UiStyle = 'wally' | 'classic' | 'clear' | 'flow' | 'aurora' | 'nodes' | 'minimal';

export interface AppConfig {
  schemaVersion: 3;
  settings: Settings;
  members: Member[];
  calendars: CalendarSource[];
  school: SchoolConfig;
}

export interface CalEvent {
  key: string;
  title: string;
  start: Date;
  /** exclusive end */
  end: Date;
  allDay: boolean;
  location?: string;
  notes?: string;
  calendarName?: string;
  /** subscribed calendars (CalendarSource ids) the event comes from; missing for demo/local events */
  calendarIds?: string[];
  /** id of the LocalEvent when this event comes from the local family calendar */
  localId?: string;
  /** id of the Birthday when this event comes from the local birthdays calendar */
  birthdayId?: string;
  /** turning age in the occurrence's year, when the birth year is stored */
  birthdayAge?: number;
  memberIds: string[];
}

export interface DateRange {
  start: Date;
  end: Date;
}

/** Public and school holidays of one day */
export interface DayMarks {
  publicNames: string[];
  schoolNames: string[];
}
