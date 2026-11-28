import type { AppConfig, CalendarSource, HolidaySettings, Member, Settings, Timetable, UiStyle } from '../types';
import { DEFAULT_PERIODS, parseSchool, parseTimetable } from './school';
import { DEFAULT_SYMBOL_SET, isSymbolSet } from './symbols';
import { DEFAULT_WEATHER_ICONS, isWeatherIconSet } from './weatherIcons';
import { PALETTE } from './colors';
import { demoId, uid } from './id';
import { persisted } from './persisted';
import { isLanguageSetting, t } from '../i18n';

const CONFIG_KEY = 'fc.config.v1';

export { PALETTE };

export const EMOJIS = [
  '👨',
  '👩',
  '👧',
  '👦',
  '👶',
  '👴',
  '👵',
  '🧑',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐸',
  '🐵',
  '🐶',
  '🐱',
  '🦄',
  '🐝',
  '🐢',
  '🐬',
  '🦖',
  '🐙',
  '⚽',
  '🎸',
  '🎨',
  '📚',
  '🚀',
  '🌻',
  '⭐',
  '❤️',
];

const LINK_HELP_IDS = [
  ['microsoft', '📧'],
  ['microsoftWork', '🏢'],
  ['google', '📅'],
  ['icloud', '🍏'],
  ['other', '🔗'],
] as const;

/** Where to find the ICS subscription link at the common providers (help text in the settings). */
export const linkHelp = (): { label: string; icon: string; help: string }[] =>
  LINK_HELP_IDS.map(([id, icon]) => ({
    icon,
    label: t(`settings.calendars.help.${id}.label`),
    help: t(`settings.calendars.help.${id}.help`),
  }));

/** German federal states (OpenHolidays subdivision codes) */
const REGION_CODES = [
  'DE-BW',
  'DE-BY',
  'DE-BE',
  'DE-BB',
  'DE-HB',
  'DE-HH',
  'DE-HE',
  'DE-MV',
  'DE-NI',
  'DE-NW',
  'DE-RP',
  'DE-SL',
  'DE-SN',
  'DE-ST',
  'DE-SH',
  'DE-TH',
] as const;

/** [code, name in the active language], sorted by name */
export const regions = (): [code: string, name: string][] =>
  REGION_CODES.map((code): [string, string] => [code, t(`regions.${code}`)]).sort((a, b) => a[1].localeCompare(b[1]));

export const DEFAULT_HOLIDAYS: HolidaySettings = { region: '', showPublic: true, showSchool: true };

export const DEFAULT_SETTINGS: Settings = {
  language: 'auto',
  proxyUrl: '',
  proxyKey: '',
  holidays: { ...DEFAULT_HOLIDAYS },
  weekStartsOn: 1,
  dayStartHour: 6,
  dayEndHour: 22,
  defaultView: 'week',
  multiDays: 3,
  refreshMinutes: 5,
  idleResetMinutes: 3,
  keepAwake: true,
  theme: 'auto',
  style: 'wally',
  symbols: DEFAULT_SYMBOL_SET,
  weatherIcons: DEFAULT_WEATHER_ICONS,
  schoolEnabled: true,
  localCalendarEnabled: true,
};

const STYLE_IDS: UiStyle[] = ['wally', 'classic', 'clear', 'flow', 'aurora', 'nodes', 'minimal'];

/** The styles with name and short description in the active language. */
export const UI_STYLES: { id: UiStyle; label: string; note: string }[] = STYLE_IDS.map((id) => ({
  id,
  get label() {
    return t(`styles.${id}.label`);
  },
  get note() {
    return t(`styles.${id}.note`);
  },
}));

/** Day count of the 'days' view. */
export function clampDays(n: number): number {
  return Math.min(6, Math.max(2, Math.round(n) || 3));
}

export function defaultConfig(): AppConfig {
  return {
    schemaVersion: 3,
    settings: { ...DEFAULT_SETTINGS, holidays: { ...DEFAULT_HOLIDAYS } },
    members: [],
    calendars: [],
    school: { colors: {}, custom: [] },
  };
}

export function newMember(existing: Member[]): Member {
  const used = new Set(existing.map((m) => m.color));
  const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[existing.length % PALETTE.length];
  return { id: uid(), name: t('settings.family.newPerson', { n: existing.length + 1 }), color, avatar: { type: 'initials' } };
}

export function newCalendar(name: string, url: string, memberIds: string[] = []): CalendarSource {
  return { id: uid(), name: name.trim() || t('settings.calendars.defaultName'), url: url.trim(), memberIds, enabled: true };
}

/** Mo..Fr × lessons; null = free. Lena goes to the Gymnasium (one long day), Max to the Grundschule. */
const DEMO_TIMETABLES: Record<'Lena' | 'Max', Timetable> = {
  Lena: {
    schoolType: 'gymnasium',
    periods: DEFAULT_PERIODS.map((p) => ({ ...p })),
    cells: [
      ['de', 'ma', 'en', 'bi', 'ge', 'sp', null, null],
      ['ma', 'ma', 'fr', 'de', 'mu', 'ku', null, null],
      ['en', 'de', 'ek', 'ma', 're', 'kl', null, null],
      ['bi', 'fr', 'de', 'de', 'ma', 'en', 'sp', 'sp'],
      ['ge', 'en', 'ma', 'fr', 'ku', 'ku', null, null],
    ],
  },
  Max: {
    schoolType: 'grundschule',
    periods: DEFAULT_PERIODS.map((p) => ({ ...p })),
    cells: [
      ['de', 'de', 'ma', 'su', 'sp', null, null, null],
      ['ma', 'de', 'en', 'mu', 'lz', null, null, null],
      ['de', 'ma', 'su', 'ku', 'ku', null, null, null],
      ['ma', 'de', 'sw', 'sw', 're', null, null, null],
      ['kr', 'de', 'ma', 'sp', null, null, null, null],
    ],
  },
};

export function demoMembers(): Member[] {
  const timetable = (name: keyof typeof DEMO_TIMETABLES): Timetable => structuredClone(DEMO_TIMETABLES[name]);
  return [
    { id: demoId(), name: t('demo.members.dad'), color: '#3b82f6', avatar: { type: 'emoji', value: '👨' }, demo: true },
    { id: demoId(), name: t('demo.members.mum'), color: '#e8613c', avatar: { type: 'emoji', value: '👩' }, demo: true },
    { id: demoId(), name: 'Lena', color: '#a855f7', avatar: { type: 'emoji', value: '🦄' }, demo: true, timetable: timetable('Lena') },
    { id: demoId(), name: 'Max', color: '#22a06b', avatar: { type: 'emoji', value: '🦖' }, demo: true, timetable: timetable('Max') },
  ];
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function parseMember(raw: unknown): Member | null {
  const m = obj(raw);
  if (typeof m.id !== 'string') return null;
  return {
    id: m.id,
    name: str(m.name),
    color: str(m.color, PALETTE[0]),
    avatar: m.avatar && typeof m.avatar === 'object' ? (m.avatar as Member['avatar']) : { type: 'initials' },
    // v1 stored demo members as source: 'demo'
    demo: m.demo === true || m.source === 'demo' || undefined,
    timetable: parseTimetable(m.timetable),
  };
}

/** Validates and normalises an unknown object (from localStorage or an imported file). Migrates version 1. */
export function parseConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') throw new Error(t('config.invalid'));
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1 && o.schemaVersion !== 2 && o.schemaVersion !== 3) throw new Error(t('config.unknownVersion'));
  if (!Array.isArray(o.members)) throw new Error(t('config.noMembers'));
  const members = o.members.map(parseMember).filter((m): m is Member => !!m);
  const memberIds = new Set(members.map((m) => m.id));

  // version 2 grouped calendars into accounts – the calendars are kept, the accounts dropped
  const calendars: CalendarSource[] = (Array.isArray(o.calendars) ? o.calendars : [])
    .map(obj)
    .filter((c) => typeof c.id === 'string')
    .map((c) => ({
      id: c.id as string,
      name: str(c.name, t('settings.calendars.defaultName')),
      url: str(c.url),
      memberIds: (Array.isArray(c.memberIds) ? c.memberIds : []).filter((id): id is string => typeof id === 'string' && memberIds.has(id)),
      enabled: c.enabled !== false,
    }));

  const s = obj(o.settings);
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (k in s && typeof s[k] === typeof DEFAULT_SETTINGS[k]) (settings as unknown as Record<string, unknown>)[k] = s[k];
  }
  settings.holidays = { ...DEFAULT_HOLIDAYS, ...obj(s.holidays) } as HolidaySettings;
  settings.multiDays = clampDays(settings.multiDays);
  if (!STYLE_IDS.includes(settings.style)) settings.style = DEFAULT_SETTINGS.style;
  // backups from before the language setting: 'auto' (= device language)
  if (!isLanguageSetting(settings.language)) settings.language = DEFAULT_SETTINGS.language;
  if (!isSymbolSet(settings.symbols)) settings.symbols = DEFAULT_SETTINGS.symbols;
  if (!isWeatherIconSet(settings.weatherIcons)) settings.weatherIcons = DEFAULT_SETTINGS.weatherIcons;

  return { schemaVersion: 3, settings, members, calendars, school: parseSchool(o.school) };
}

/** The family configuration (people, calendars, settings) of this device. Invalid data falls back to the defaults. */
export const configStore = persisted<AppConfig>(CONFIG_KEY, (raw) => (raw === undefined ? defaultConfig() : parseConfig(raw)));

export function exportConfig(cfg: AppConfig): void {
  const payload = { ...cfg, exportedAt: new Date().toISOString(), app: 'family-calendar' };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `${t('settings.backup.fileName')}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function readConfigFile(file: File): Promise<AppConfig> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(t('config.noJson'));
  }
  return parseConfig(json);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Resizes an uploaded photo to a square JPEG data URL (keeps the config small). */
export function imageFileToAvatar(file: File, size = 192): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error(t('config.noCanvas')));
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t('config.badImage')));
    };
    img.src = url;
  });
}
