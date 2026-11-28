import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalEvent, CalendarSource, DateRange, Member } from '../types';
import { parseIcs, icsCalendarName } from './ics';
import { demoEvents } from './demo';
import { configStore } from './config';
import { expandLocalEvents, localEvents } from './localEvents';
import { arrayOf, isString, storage, usePersisted } from './persisted';
import { isNative, nativeGetText } from '../native/launcher';
import { t } from '../i18n';

export type CalStatus = { state: 'ok' } | { state: 'error'; message: string };

const CACHE_PREFIX = 'fc.events.';
const CACHE_INDEX = 'fc.events.index';
const CACHE_MAX = 8;
/** ICS files are kept in memory this long when only the visible range changes */
const TEXT_TTL_MS = 5 * 60_000;

type Serialized = Omit<CalEvent, 'start' | 'end'> & { start: string; end: string };

function cacheKey(range: DateRange, calendars: CalendarSource[]): string {
  const sig = calendars.map((c) => c.id + ':' + c.memberIds.join(',')).join('|');
  return `${range.start.getTime()}-${range.end.getTime()}-${hash(sig)}`;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function readCache(key: string): CalEvent[] | null {
  const raw = storage.read(CACHE_PREFIX + key);
  if (!Array.isArray(raw)) return null;
  return (raw as Serialized[]).map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
}

/** keeps the last CACHE_MAX ranges; caching is best effort (a full storage just skips it) */
function writeCache(key: string, events: CalEvent[]): void {
  const next = [key, ...arrayOf(storage.read(CACHE_INDEX), isString).filter((k) => k !== key)];
  for (const old of next.slice(CACHE_MAX)) storage.remove(CACHE_PREFIX + old);
  storage.write(CACHE_INDEX, next.slice(0, CACHE_MAX));
  storage.write(CACHE_PREFIX + key, events);
}

/* ------------------------------------------------------------------ fetching */

const textCache = new Map<string, { text: string; at: number }>();

export function normalizeIcsUrl(url: string): string {
  return url.trim().replace(/^webcals?:\/\//i, 'https://');
}

/** The Cloudflare worker that fetches the calendars, with its optional access key. */
export interface Proxy {
  url: string;
  key: string;
}

export const proxyOf = (s: { proxyUrl: string; proxyKey: string }): Proxy => ({ url: s.proxyUrl, key: s.proxyKey });

const proxyBase = (proxy: Proxy) => proxy.url.trim().replace(/\/+$/, '');

/**
 * Loads an ICS link through the Cloudflare worker (calendar providers don't allow direct browser access).
 * The secret link goes in the request body, so it does not end up in the worker's URL logs.
 * `force` also makes the worker skip its edge cache.
 */
export async function fetchIcs(proxy: Proxy, url: string, force = false): Promise<string> {
  const target = normalizeIcsUrl(url);
  const hit = textCache.get(target);
  if (!force && hit && Date.now() - hit.at < TEXT_TTL_MS) return hit.text;
  // the Android app may load the link itself: no worker needed, the secret link stays on the device
  if (isNative) {
    let res: { status: number; text: string };
    try {
      res = await nativeGetText(target);
    } catch {
      throw new Error(t('events.unreachable'));
    }
    if (res.status < 200 || res.status >= 300) throw new Error(t('events.serverError', { status: res.status }));
    if (!res.text.trimStart().startsWith('BEGIN:VCALENDAR')) throw new Error(t('events.notCalendar'));
    textCache.set(target, { text: res.text, at: Date.now() });
    return res.text;
  }
  const base = proxyBase(proxy);
  if (!base) throw new Error(t('events.noProxy'));
  const key = proxy.key.trim();
  let res: Response;
  try {
    // text/plain and no extra header (without a key) = a "simple" request without CORS preflight
    res = await fetch(`${base}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...(key ? { 'X-Access-Key': key } : {}) },
      body: JSON.stringify({ url: target, fresh: force }),
      cache: 'no-store',
    });
  } catch {
    throw new Error(t('events.proxyUnreachable'));
  }
  const text = await res.text();
  if (!res.ok) throw new Error(proxyError(text, res.status));
  if (!text.trimStart().startsWith('BEGIN:VCALENDAR')) throw new Error(t('events.notCalendar'));
  textCache.set(target, { text, at: Date.now() });
  return text;
}

/** the proxy's error codes (see worker/worker.js) in the app's language */
const PROXY_ERRORS = [
  'method_not_allowed',
  'bad_request',
  'key_invalid',
  'missing_url',
  'invalid_link',
  'https_only',
  'host_not_allowed',
  'redirect_not_allowed',
  'too_many_redirects',
  'unreachable',
  'upstream_error',
  'too_large',
  'not_calendar',
] as const;

export function proxyError(body: string, status: number): string {
  let err: { error?: string; detail?: string } | null = null;
  try {
    err = JSON.parse(body);
  } catch {
    /* not an answer of the proxy */
  }
  const code = PROXY_ERRORS.find((c) => c === err?.error);
  return code ? t(`events.proxyErrors.${code}`, { detail: err?.detail ?? '' }) : t('events.error', { status });
}

export type ProxyCheck = { ok: true; text: string } | { ok: false; text: string };

/** For the settings: is the worker reachable, is it up to date and does the access key fit? */
export async function checkProxy(proxy: Proxy): Promise<ProxyCheck> {
  const base = proxyBase(proxy);
  const key = proxy.key.trim();
  let res: Response;
  try {
    res = await fetch(`${base}/`, { cache: 'no-store', headers: key ? { 'X-Access-Key': key } : {} });
  } catch {
    return {
      ok: false,
      text: key ? t('events.unreachableKey') : t('events.unreachableNoKey'),
    };
  }
  const text = await res.text();
  let info: { service?: string; keyRequired?: boolean; keyOk?: boolean } | null = null;
  try {
    info = JSON.parse(text);
  } catch {
    /* not the proxy */
  }
  if (info?.service === 'homewally-ics-proxy') {
    if (info.keyRequired && !info.keyOk) return { ok: false, text: key ? t('events.wrongKey') : t('events.keyRequired') };
    return { ok: true, text: info.keyRequired ? t('events.proxyOkKey') : t('events.proxyOk') };
  }
  return { ok: false, text: t('events.unexpected', { status: res.status }) };
}

/** For the settings: checks a link and returns the calendar name and number of upcoming events. */
export async function testCalendarLink(proxy: Proxy, url: string): Promise<{ name?: string; upcoming: number }> {
  const text = await fetchIcs(proxy, url, true);
  const from = new Date();
  const to = new Date(from.getTime() + 60 * 86400000);
  return { name: icsCalendarName(text), upcoming: parseIcs(text, from, to).length };
}

async function fetchCalendar(proxy: Proxy, cal: CalendarSource, range: DateRange, force: boolean): Promise<CalEvent[]> {
  const text = await fetchIcs(proxy, cal.url, force);
  return parseIcs(text, range.start, range.end).map((e) => ({
    key: `${e.uid}|${e.start.getTime()}`,
    title: e.title,
    start: e.start,
    end: e.end.getTime() > e.start.getTime() ? e.end : new Date(e.start.getTime() + (e.allDay ? 86400000 : 15 * 60000)),
    allDay: e.allDay,
    location: e.location,
    notes: e.notes,
    calendarName: cal.name,
    calendarIds: [cal.id],
    memberIds: [...cal.memberIds],
  }));
}

/** Merges the same meeting appearing in several family members' calendars into one event. */
export function merge(lists: CalEvent[][]): CalEvent[] {
  const map = new Map<string, CalEvent>();
  for (const list of lists) {
    for (const e of list) {
      const existing = map.get(e.key);
      if (existing) {
        for (const id of e.memberIds) if (!existing.memberIds.includes(id)) existing.memberIds.push(id);
        if (e.calendarIds) existing.calendarIds = [...new Set([...(existing.calendarIds ?? []), ...e.calendarIds])];
      } else {
        map.set(e.key, { ...e, memberIds: [...e.memberIds], calendarIds: e.calendarIds && [...e.calendarIds] });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
}

/**
 * The cached events of one calendar (used when loading it fails). Matched by calendar id, so a
 * renamed calendar or two calendars with the same name keep their own events; caches written
 * before ids were stored fall back to the name.
 */
export function cachedEventsOf(cached: CalEvent[], cal: CalendarSource): CalEvent[] {
  return cached
    .filter((ev) => (ev.calendarIds ? ev.calendarIds.includes(cal.id) : ev.calendarName === cal.name))
    .map((ev) => ({ ...ev, calendarIds: [cal.id], memberIds: ev.memberIds.filter((m) => cal.memberIds.includes(m)) }))
    .filter((ev) => ev.memberIds.length > 0);
}

export interface EventsState {
  events: CalEvent[];
  loading: boolean;
  /** per calendar id */
  status: Record<string, CalStatus>;
  lastUpdated?: Date;
}

export function useEvents(
  range: DateRange,
  members: Member[],
  calendars: CalendarSource[],
  proxy: Proxy,
  refreshNonce: number,
): EventsState {
  const [state, setState] = useState<EventsState>({ events: [], loading: false, status: {} });
  const local = usePersisted(localEvents);
  const localEnabled = usePersisted(configStore).settings.localCalendarEnabled;
  const runId = useRef(0);
  const lastNonce = useRef(refreshNonce);
  const active = calendars.filter((c) => c.enabled && c.url && c.memberIds.length > 0);
  const key = cacheKey(range, active);
  const sig = JSON.stringify([
    proxy.url,
    proxy.key,
    active.map((c) => [c.id, c.url, c.name, c.memberIds]),
    members.map((m) => [m.id, m.demo]),
  ]);

  useEffect(() => {
    const id = ++runId.current;
    const force = refreshNonce !== lastNonce.current;
    lastNonce.current = refreshNonce;
    const demo = demoEvents(members, range);
    const cached = readCache(key);
    // show cached events at once while the calendars load
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, events: merge([demo, cached ?? []]), loading: active.length > 0 }));

    if (active.length === 0) {
      setState({ events: merge([demo]), loading: false, status: {}, lastUpdated: new Date() });
      return;
    }

    (async () => {
      const status: Record<string, CalStatus> = {};
      const results = await Promise.all(
        active.map(async (cal) => {
          try {
            const evs = await fetchCalendar(proxy, cal, range, force);
            status[cal.id] = { state: 'ok' };
            return evs;
          } catch (e) {
            status[cal.id] = { state: 'error', message: e instanceof Error ? e.message : String(e) };
            // keep previously cached events of this calendar if the fetch failed
            return cachedEventsOf(cached ?? [], cal);
          }
        }),
      );
      if (id !== runId.current) return;
      const real = merge(results);
      if (Object.values(status).every((s) => s.state === 'ok')) writeCache(key, real);
      setState({ events: merge([demo, real]), loading: false, status, lastUpdated: new Date() });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sig, refreshNonce]);

  const events = useMemo(() => {
    if (!localEnabled || local.length === 0) return state.events;
    const validIds = new Set(members.map((m) => m.id));
    const expanded = expandLocalEvents(local, range, validIds);
    return expanded.length ? merge([state.events, expanded]) : state.events;
  }, [state.events, localEnabled, local, members, range]);

  return { ...state, events };
}
