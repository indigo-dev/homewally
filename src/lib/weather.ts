import { useEffect, useSyncExternalStore } from 'react';
import { uid } from './id';
import { arrayOf, isRecord, persisted, storage, usePersisted } from './persisted';
import { isNative } from '../native/launcher';
import { getLanguage, t, type Messages } from '../i18n';
import { dayKey, fmtClock, fmtHHMM, uses12h } from './dates';

/**
 * Weather: forecast, 15-minute precipitation nowcast, air quality, pollen and UV from Open-Meteo,
 * official warnings of the DWD via Bright Sky.
 * All free, no API key, CORS enabled. Places and the last fetched data live in localStorage
 * (per device, like the photo frame), so the wall display still shows the last state offline.
 */

export interface Place {
  id: string;
  name: string;
  /** "Bayern" / "Landkreis …" – only to tell places with the same name apart */
  region?: string;
  lat: number;
  lon: number;
}

export interface WeatherSettings {
  /** the first place is "home": calendar header, day columns and screensaver use it */
  places: Place[];
  /** place shown in the weather module */
  activeId?: string;
}

export interface Current {
  time: string;
  temp: number;
  feels: number;
  code: number;
  isDay: boolean;
  wind: number;
  gusts: number;
  /** degrees, where the wind comes from */
  windDir: number;
  humidity: number;
  precipitation: number;
  /** hPa, reduced to sea level */
  pressure: number;
  /** % */
  cloud: number;
  dewPoint: number;
  /** metres */
  visibility: number;
  uv: number;
}

export interface Hour {
  time: string;
  temp: number;
  code: number;
  isDay: boolean;
  rainProb: number;
  /** mm in this hour */
  rain: number;
  uv: number;
  feels: number;
  wind: number;
  gusts: number;
  windDir: number;
  humidity: number;
  cloud: number;
  dewPoint: number;
  /** hPa, reduced to sea level */
  pressure: number;
  /** metres */
  visibility: number;
  /** cm in this hour */
  snow: number;
}

export interface Day {
  /** yyyy-mm-dd */
  date: string;
  code: number;
  max: number;
  min: number;
  rainProb: number;
  rainSum: number;
  uvMax: number;
  sunrise: string;
  sunset: string;
  feelsMax: number;
  feelsMin: number;
  /** seconds of sunshine */
  sunshine: number;
  /** seconds between sunrise and sunset */
  daylight: number;
  /** hours with precipitation */
  rainHours: number;
  /** cm */
  snowSum: number;
  windMax: number;
  gustsMax: number;
  /** degrees, dominant direction the wind comes from */
  windDir: number;
}

/** precipitation in 15-minute steps for the next hours (DWD ICON-D2 in Central Europe) */
export interface Quarter {
  time: string;
  /** mm in these 15 minutes */
  rain: number;
  /** cm in these 15 minutes */
  snow: number;
}

/** air quality of one hour (CAMS Europe) */
export interface AirHour {
  time: string;
  /** European Air Quality Index */
  aqi: number;
  /** µg/m³ */
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
}

export type PollenType = 'alder' | 'birch' | 'grass' | 'mugwort' | 'ragweed';

export interface PollenDay {
  date: string;
  /** daily maximum in grains/m³ */
  values: Record<PollenType, number>;
}

export interface Alert {
  id: number;
  severity: 'minor' | 'moderate' | 'severe' | 'extreme';
  event: string;
  headline: string;
  description: string;
  instruction: string;
  /** English texts of the warning (if the DWD published them) */
  en?: { event: string; headline: string; description: string; instruction: string };
  onset: string;
  expires: string | null;
}

export interface WeatherData {
  fetchedAt: number;
  current: Current;
  hours: Hour[];
  days: Day[];
  /** null outside the nowcast area */
  nowcast: Quarter[] | null;
  /** null when the pollen service failed – the rest still works */
  pollen: PollenDay[] | null;
  /** null when the air quality service failed */
  air: AirHour[] | null;
  /** null when the warning service failed */
  alerts: Alert[] | null;
  /** DWD warn cell, e.g. "Berl. - Mitte" */
  warnCell?: string;
}

/* ------------------------------------------------------------------ settings */

const KEY = 'fc.weather';
/** cached data per place; the version changes with the data shape */
const DATA_KEY = 'fc.weather.v3.';
/** data older than this is fetched again */
const STALE_MS = 20 * 60_000;
/** don't hammer the services after an error */
const RETRY_MS = 3 * 60_000;

const isPlace = (p: unknown): p is Place =>
  isRecord(p) && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.lat === 'number' && typeof p.lon === 'number';

export const weatherSettings = persisted<WeatherSettings>(KEY, (raw) => {
  const v = isRecord(raw) ? raw : {};
  const places = arrayOf(v.places, isPlace);
  return { places, activeId: places.some((p) => p.id === v.activeId) ? (v.activeId as string) : places[0]?.id };
});

// cached data of another data shape is useless – drop it
storage
  .keys()
  .filter((k) => k.startsWith('fc.weather.') && !k.startsWith(DATA_KEY))
  .forEach(storage.remove);

export function useWeatherSettings(): WeatherSettings {
  return usePersisted(weatherSettings);
}

/** Rounds to ~1 km: precise enough for weather, doesn't hand out the exact address. */
const round = (n: number) => Math.round(n * 100) / 100;

export function addPlace(p: Omit<Place, 'id'>): Place {
  const lat = round(p.lat);
  const lon = round(p.lon);
  const existing = weatherSettings.get().places.find((x) => x.lat === lat && x.lon === lon);
  if (existing) {
    setActivePlace(existing.id);
    return existing;
  }
  const place: Place = { ...p, lat, lon, id: uid() };
  weatherSettings.set((s) => ({ places: [...s.places, place], activeId: place.id }));
  return place;
}

export function removePlace(id: string) {
  storage.remove(DATA_KEY + id);
  cache.delete(id);
  weatherSettings.set((s) => {
    const places = s.places.filter((p) => p.id !== id);
    return { places, activeId: s.activeId === id ? places[0]?.id : s.activeId };
  });
}

export function renamePlace(id: string, name: string) {
  weatherSettings.set((s) => ({ ...s, places: s.places.map((p) => (p.id === id ? { ...p, name } : p)) }));
}

/** Moves a place to the top – it becomes "home". */
export function makeHome(id: string) {
  weatherSettings.set((s) => {
    const p = s.places.find((x) => x.id === id);
    return p ? { ...s, places: [p, ...s.places.filter((x) => x.id !== id)] } : s;
  });
}

export function setActivePlace(id: string) {
  weatherSettings.set((s) => ({ ...s, activeId: id }));
}

/* ------------------------------------------------------------------ location */

export interface SearchHit {
  name: string;
  region?: string;
  lat: number;
  lon: number;
}

/** Place search (Open-Meteo geocoding, Germany only). */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=${getLanguage()}&countryCode=DE`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; admin3?: string; admin4?: string }[];
  };
  return (json.results ?? []).map((r) => ({
    name: r.name,
    region: [r.admin4 !== r.name ? r.admin4 : undefined, r.admin1].filter(Boolean).join(', ') || undefined,
    lat: r.latitude,
    lon: r.longitude,
  }));
}

export const isApple = () => /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;

/** Why locating failed, with a hint the family can act on. */
export class LocateError extends Error {
  constructor(
    message: string,
    public help?: string[],
    public canOpenSettings = false,
  ) {
    super(message);
  }
}

function position(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
}

/**
 * Asks the browser for the device position once. Tablets without GPS often fail the first, quick
 * attempt (Wi-Fi positioning still warming up) – then it tries again more patiently.
 */
export async function locate(): Promise<{ lat: number; lon: number }> {
  if (!window.isSecureContext) {
    throw new LocateError(t('weather.locate.https'));
  }
  if (!('geolocation' in navigator)) throw new LocateError(t('weather.locate.unsupported'));
  let pos: GeolocationPosition;
  try {
    pos = await position({ enableHighAccuracy: false, timeout: 12_000, maximumAge: 60 * 60_000 });
  } catch (e) {
    const err = e as GeolocationPositionError;
    if (err.code === err.PERMISSION_DENIED) throw denied();
    try {
      pos = await position({ enableHighAccuracy: true, timeout: 25_000, maximumAge: 0 });
    } catch (e2) {
      const err2 = e2 as GeolocationPositionError;
      if (err2.code === err2.PERMISSION_DENIED) throw denied();
      throw new LocateError(t('weather.locate.failed'), isApple() ? [t('weather.locate.failedHelpApple')] : undefined);
    }
  }
  return { lat: pos.coords.latitude, lon: pos.coords.longitude };
}

function denied() {
  if (isNative) {
    return new LocateError(t('weather.locate.denied'), [t('weather.locate.deniedAndroid')], true);
  }
  return new LocateError(
    t('weather.locate.denied'),
    isApple()
      ? [
          t('weather.locate.deniedApple1'),
          t('weather.locate.deniedApple2'),
          t('weather.locate.deniedApple3'),
          t('weather.locate.deniedApple4'),
        ]
      : [t('weather.locate.deniedOther')],
  );
}

/* ------------------------------------------------------------------ fetching */

const POLLEN: PollenType[] = ['alder', 'birch', 'grass', 'mugwort', 'ragweed'];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface ForecastJson {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    is_day: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
    wind_direction_10m: number;
    relative_humidity_2m: number;
    precipitation: number;
    pressure_msl: number;
    cloud_cover: number;
    dew_point_2m: number;
    visibility: number;
    uv_index: number | null;
  };
  minutely_15?: { time: string[]; precipitation: (number | null)[]; snowfall: (number | null)[] };
  hourly: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    is_day: number[];
    precipitation_probability: (number | null)[];
    precipitation: (number | null)[];
    uv_index: (number | null)[];
    apparent_temperature: number[];
    wind_speed_10m: number[];
    wind_gusts_10m: number[];
    wind_direction_10m: number[];
    relative_humidity_2m: number[];
    cloud_cover: number[];
    dew_point_2m: number[];
    pressure_msl: number[];
    visibility: number[];
    snowfall: (number | null)[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum: (number | null)[];
    uv_index_max: (number | null)[];
    sunrise: string[];
    sunset: string[];
    apparent_temperature_max: number[];
    apparent_temperature_min: number[];
    sunshine_duration: (number | null)[];
    daylight_duration: number[];
    precipitation_hours: (number | null)[];
    snowfall_sum: (number | null)[];
    wind_speed_10m_max: number[];
    wind_gusts_10m_max: number[];
    wind_direction_10m_dominant: number[];
  };
}

async function fetchForecast(p: Place) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,' +
    'precipitation,pressure_msl,cloud_cover,dew_point_2m,visibility,uv_index' +
    '&minutely_15=precipitation,snowfall&forecast_minutely_15=12' +
    '&hourly=temperature_2m,weather_code,is_day,precipitation_probability,precipitation,uv_index,apparent_temperature,' +
    'wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,cloud_cover,dew_point_2m,pressure_msl,visibility,snowfall' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset,' +
    'apparent_temperature_max,apparent_temperature_min,sunshine_duration,daylight_duration,precipitation_hours,snowfall_sum,' +
    'wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant' +
    '&timezone=Europe%2FBerlin&past_days=1&forecast_days=8';
  const j = await getJson<ForecastJson>(url);
  const c = j.current;
  const h = j.hourly;
  const d = j.daily;
  const q = j.minutely_15;
  return {
    current: {
      time: c.time,
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      code: c.weather_code,
      isDay: c.is_day === 1,
      wind: c.wind_speed_10m,
      gusts: c.wind_gusts_10m,
      windDir: c.wind_direction_10m,
      humidity: c.relative_humidity_2m,
      precipitation: c.precipitation,
      pressure: c.pressure_msl,
      cloud: c.cloud_cover,
      dewPoint: c.dew_point_2m,
      visibility: c.visibility,
      uv: c.uv_index ?? 0,
    },
    // values are null where the nowcast model does not reach
    nowcast:
      q && q.precipitation.some((v) => v !== null)
        ? q.time.map((time, i) => ({ time, rain: q.precipitation[i] ?? 0, snow: q.snowfall[i] ?? 0 }))
        : null,
    hours: h.time.map((time, i) => ({
      time,
      temp: h.temperature_2m[i],
      code: h.weather_code[i],
      isDay: h.is_day[i] === 1,
      rainProb: h.precipitation_probability[i] ?? 0,
      rain: h.precipitation[i] ?? 0,
      uv: h.uv_index[i] ?? 0,
      feels: h.apparent_temperature[i],
      wind: h.wind_speed_10m[i],
      gusts: h.wind_gusts_10m[i],
      windDir: h.wind_direction_10m[i],
      humidity: h.relative_humidity_2m[i],
      cloud: h.cloud_cover[i],
      dewPoint: h.dew_point_2m[i],
      pressure: h.pressure_msl[i],
      visibility: h.visibility[i],
      snow: h.snowfall[i] ?? 0,
    })),
    days: d.time.map((date, i) => ({
      date,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      rainProb: d.precipitation_probability_max[i] ?? 0,
      rainSum: d.precipitation_sum[i] ?? 0,
      uvMax: d.uv_index_max[i] ?? 0,
      sunrise: d.sunrise[i],
      sunset: d.sunset[i],
      feelsMax: d.apparent_temperature_max[i],
      feelsMin: d.apparent_temperature_min[i],
      sunshine: d.sunshine_duration[i] ?? 0,
      daylight: d.daylight_duration[i],
      rainHours: d.precipitation_hours[i] ?? 0,
      snowSum: d.snowfall_sum[i] ?? 0,
      windMax: d.wind_speed_10m_max[i],
      gustsMax: d.wind_gusts_10m_max[i],
      windDir: d.wind_direction_10m_dominant[i],
    })),
  };
}

/** pollen per day and air quality per hour – one request to the air quality service */
async function fetchAir(p: Place): Promise<{ pollen: PollenDay[]; air: AirHour[] }> {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}` +
    `&hourly=${POLLEN.map((t) => `${t}_pollen`).join(',')},european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone` +
    '&timezone=Europe%2FBerlin&forecast_days=4';
  const j = await getJson<{ hourly: Record<string, (number | null)[]> & { time: string[] } }>(url);
  const v = (key: string, i: number) => j.hourly[key]?.[i] ?? null;
  const air: AirHour[] = [];
  j.hourly.time.forEach((time, i) => {
    const aqi = v('european_aqi', i);
    if (aqi === null) return;
    air.push({ time, aqi, pm25: v('pm2_5', i) ?? 0, pm10: v('pm10', i) ?? 0, no2: v('nitrogen_dioxide', i) ?? 0, o3: v('ozone', i) ?? 0 });
  });
  const byDay = new Map<string, Record<PollenType, number>>();
  j.hourly.time.forEach((t, i) => {
    const date = t.slice(0, 10);
    const rec = byDay.get(date) ?? { alder: 0, birch: 0, grass: 0, mugwort: 0, ragweed: 0 };
    for (const type of POLLEN) rec[type] = Math.max(rec[type], j.hourly[`${type}_pollen`]?.[i] ?? 0);
    byDay.set(date, rec);
  });
  return { pollen: [...byDay].map(([date, values]) => ({ date, values })), air };
}

interface AlertsJson {
  alerts: {
    id: number;
    severity: Alert['severity'];
    event_de: string;
    headline_de: string;
    description_de: string;
    instruction_de: string | null;
    event_en?: string | null;
    headline_en?: string | null;
    description_en?: string | null;
    instruction_en?: string | null;
    onset: string;
    expires: string | null;
  }[];
  location?: { name?: string };
}

async function fetchAlerts(p: Place): Promise<{ alerts: Alert[]; warnCell?: string }> {
  const j = await getJson<AlertsJson>(`https://api.brightsky.dev/alerts?lat=${p.lat}&lon=${p.lon}&tz=Europe/Berlin`);
  return {
    warnCell: j.location?.name,
    alerts: (j.alerts ?? []).map((a) => ({
      id: a.id,
      severity: a.severity,
      event: a.event_de,
      headline: a.headline_de,
      description: a.description_de,
      instruction: a.instruction_de ?? '',
      // the DWD also publishes the warnings in English
      en: a.headline_en
        ? {
            event: a.event_en ?? a.event_de,
            headline: a.headline_en,
            description: a.description_en ?? a.description_de,
            instruction: a.instruction_en ?? '',
          }
        : undefined,
      onset: a.onset,
      expires: a.expires,
    })),
  };
}

/* ------------------------------------------------------------------ data store */

interface Entry {
  data: WeatherData | null;
  loading: boolean;
  error?: string;
  lastTry: number;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function entry(id: string): Entry {
  let e = cache.get(id);
  if (!e) {
    const data = storage.read(DATA_KEY + id);
    // only data of this version is ever stored under DATA_KEY
    e = { data: isRecord(data) ? (data as unknown as WeatherData) : null, loading: false, lastTry: 0 };
    cache.set(id, e);
  }
  return e;
}

function put(id: string, patch: Partial<Entry>) {
  cache.set(id, { ...entry(id), ...patch });
  emit();
}

/** Fetches a place if its data is stale (or `force`). Errors keep the last data. */
export async function refresh(place: Place, force = false) {
  const e = entry(place.id);
  if (e.loading) return;
  const now = Date.now();
  if (!force) {
    if (e.data && now - e.data.fetchedAt < STALE_MS) return;
    if (e.error && now - e.lastTry < RETRY_MS) return;
  }
  put(place.id, { loading: true, lastTry: now });
  const [forecast, air, alerts] = await Promise.allSettled([fetchForecast(place), fetchAir(place), fetchAlerts(place)]);
  if (forecast.status === 'rejected') {
    put(place.id, {
      loading: false,
      error: navigator.onLine ? t('weather.loadError') : t('weather.offline'),
    });
    return;
  }
  const data: WeatherData = {
    fetchedAt: Date.now(),
    ...forecast.value,
    pollen: air.status === 'fulfilled' ? air.value.pollen : (e.data?.pollen ?? null),
    air: air.status === 'fulfilled' && air.value.air.length ? air.value.air : (e.data?.air ?? null),
    alerts: alerts.status === 'fulfilled' ? alerts.value.alerts : null,
    warnCell: alerts.status === 'fulfilled' ? alerts.value.warnCell : e.data?.warnCell,
  };
  storage.write(DATA_KEY + place.id, data); // full storage: memory only
  put(place.id, { data, loading: false, error: undefined });
}

const EMPTY: Entry = { data: null, loading: false, lastTry: 0 };

/**
 * Weather of a place; fetches when stale and re-checks every few minutes.
 * Many components may use it for the same place – only one request runs.
 */
export function useWeather(place: Place | undefined): Entry {
  const e = useSyncExternalStore(subscribe, () => (place ? entry(place.id) : EMPTY));
  useEffect(() => {
    if (!place) return;
    refresh(place);
    const t = setInterval(() => refresh(place), 5 * 60_000);
    const onVis = () => document.visibilityState === 'visible' && refresh(place);
    const onOnline = () => refresh(place, true);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
    // the coordinates identify the request; a rename must not refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id, place?.lat, place?.lon]);
  return e;
}

/** Weather of the home place (first in the list). */
export function useHomeWeather() {
  const { places } = useWeatherSettings();
  const home = places[0];
  return { place: home, ...useWeather(home) };
}

/** Daily forecast of the home place by `yyyy-mm-dd`, for the calendar's day columns. */
export function useHomeDays(): Map<string, Day> {
  const { data } = useHomeWeather();
  const map = new Map<string, Day>();
  data?.days.forEach((d) => map.set(d.date, d));
  return map;
}

/* ------------------------------------------------------------------ presentation helpers */

type CodeKey = keyof Messages['weather']['codes'];

function condition(code: number, night: boolean): { key: CodeKey; icon: string } | null {
  switch (code) {
    case 0:
      return { key: 'clear', icon: night ? '🌙' : '☀️' };
    case 1:
      return { key: 'mainlyClear', icon: night ? '🌙' : '🌤️' };
    case 2:
      return { key: 'partlyCloudy', icon: night ? '☁️' : '⛅' };
    case 3:
      return { key: 'overcast', icon: '☁️' };
    case 45:
    case 48:
      return { key: 'fog', icon: '🌫️' };
    case 51:
    case 53:
    case 55:
      return { key: 'drizzle', icon: '🌦️' };
    case 56:
    case 57:
      return { key: 'freezingDrizzle', icon: '🌧️' };
    case 61:
      return { key: 'lightRain', icon: '🌦️' };
    case 63:
      return { key: 'rain', icon: '🌧️' };
    case 65:
      return { key: 'heavyRain', icon: '🌧️' };
    case 66:
    case 67:
      return { key: 'freezingRain', icon: '🌧️' };
    case 71:
      return { key: 'lightSnow', icon: '🌨️' };
    case 73:
      return { key: 'snow', icon: '🌨️' };
    case 75:
      return { key: 'heavySnow', icon: '❄️' };
    case 77:
      return { key: 'snowGrains', icon: '🌨️' };
    case 80:
      return { key: 'showers', icon: '🌦️' };
    case 81:
      return { key: 'heavyShowers', icon: '🌧️' };
    case 82:
      return { key: 'violentShowers', icon: '⛈️' };
    case 85:
    case 86:
      return { key: 'snowShowers', icon: '🌨️' };
    case 95:
      return { key: 'thunder', icon: '⛈️' };
    case 96:
    case 99:
      return { key: 'thunderHail', icon: '⛈️' };
    default:
      return null;
  }
}

/** WMO weather code -> text in the active language + emoji (night variant for clear/partly cloudy). */
export function describe(code: number, isDay = true): { text: string; icon: string } {
  const c = condition(code, !isDay);
  return c ? { text: t(`weather.codes.${c.key}`), icon: c.icon } : { text: '–', icon: '🌡️' };
}

export const deg = (t: number) => `${Math.round(t)}°`;

export type Level = 0 | 1 | 2 | 3 | 4;

/** UV index -> WHO level 0 (none) … 4 (very high / extreme). */
export function uvLevel(uv: number): { level: Level; label: string } {
  if (uv < 0.5) return { level: 0, label: t('weather.uv.none') };
  if (uv < 3) return { level: 1, label: t('weather.uv.low') };
  if (uv < 6) return { level: 2, label: t('weather.uv.moderate') };
  if (uv < 8) return { level: 3, label: t('weather.uv.high') };
  return { level: 4, label: uv < 11 ? t('weather.uv.veryHigh') : t('weather.uv.extreme') };
}

/** Hours of a day with UV ≥ 3 ("Sonnenschutz nötig"), e.g. "11–16 Uhr". */
export function protectionWindow(hours: Hour[], date: string): string | null {
  const hs = hours.filter((h) => h.time.startsWith(date) && h.uv >= 3).map((h) => Number(h.time.slice(11, 13)));
  if (!hs.length) return null;
  const from = Math.min(...hs);
  const to = Math.max(...hs) + 1;
  return uses12h() ? `${fmtClock(from)}–${fmtClock(to % 24)}` : t('weather.hoursRange', { from, to });
}

// grains/m³ for low / moderate / high (rough thresholds used by European pollen services)
const POLLEN_LIMITS: [PollenType, [number, number, number]][] = [
  ['alder', [1, 10, 100]],
  ['birch', [1, 10, 100]],
  ['grass', [1, 10, 50]],
  ['mugwort', [1, 10, 50]],
  ['ragweed', [1, 5, 20]],
];

export const POLLEN_TYPES: { id: PollenType; label: string; limits: [number, number, number] }[] = POLLEN_LIMITS.map(([id, limits]) => ({
  id,
  limits,
  get label() {
    return t(`weather.pollenTypes.${id}`);
  },
}));

const POLLEN_LEVEL_KEYS = ['none', 'low', 'moderate', 'high'] as const;

/** pollen level 0..3 → name in the active language */
export const pollenLabel = (level: number): string => t(`weather.pollenLevels.${POLLEN_LEVEL_KEYS[level] ?? 'none'}`);

export function pollenLevel(type: PollenType, value: number): 0 | 1 | 2 | 3 {
  const l = POLLEN_TYPES.find((t) => t.id === type)!.limits;
  if (value < l[0]) return 0;
  if (value < l[1]) return 1;
  if (value < l[2]) return 2;
  return 3;
}

export const SEVERITY_LABEL: Record<Alert['severity'], string> = {
  get minor() {
    return t('weather.severity.minor');
  },
  get moderate() {
    return t('weather.severity.moderate');
  },
  get severe() {
    return t('weather.severity.severe');
  },
  get extreme() {
    return t('weather.severity.extreme');
  },
};

/** Alerts that are still valid at `now`, in English where the DWD has an English version and the app speaks English. */
export function activeAlerts(data: WeatherData | null, now: Date): Alert[] {
  const english = getLanguage() !== 'de';
  return (data?.alerts ?? []).filter((a) => !a.expires || new Date(a.expires) > now).map((a) => (english && a.en ? { ...a, ...a.en } : a));
}

/** time of an ISO timestamp ('…T06:42') in the active clock format */
export const fmtTime = (iso: string) => fmtHHMM(iso.slice(11, 16));

/* ------------------------------------------------------------------ derived values (weather module) */

const pad2 = (n: number) => String(n).padStart(2, '0');
/** local 'yyyy-mm-ddThh:mm' of a date – the format the services use for Europe/Berlin */
export const localIso = (d: Date) => `${dayKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export type AqiLevel = 1 | 2 | 3 | 4 | 5 | 6;
const AQI_KEYS = ['good', 'fair', 'moderate', 'poor', 'veryPoor', 'extremelyPoor'] as const;

/** European Air Quality Index → level 1 (good) … 6 (extremely poor), bands of 20 */
export function aqiLevel(aqi: number): { level: AqiLevel; label: string } {
  const level = Math.min(6, Math.max(1, Math.ceil(aqi / 20))) as AqiLevel;
  return { level, label: t(`weather.aqi.levels.${AQI_KEYS[level - 1]}`) };
}

/** upper limits (km/h) of Beaufort 0 … 11; above is 12 */
const BEAUFORT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];

/** wind speed → Beaufort number and its name in the active language */
export function beaufort(kmh: number): { bft: number; label: string } {
  const i = BEAUFORT.findIndex((limit) => kmh < limit);
  const bft = i === -1 ? 12 : i;
  return { bft, label: t('weather.beaufort').split(',')[bft] };
}

/** pressure tendency over the three hours up to `time` (meteorological rule: ±1 hPa) */
export function pressureTrend(hours: Hour[], time: string): 'rising' | 'falling' | 'steady' | null {
  const i = hours.findIndex((h) => h.time === time);
  if (i < 3) return null;
  const d = hours[i].pressure - hours[i - 3].pressure;
  return d >= 1 ? 'rising' : d <= -1 ? 'falling' : 'steady';
}

export interface Nowcast {
  /** the quarters from now on (two hours) */
  slots: Quarter[];
  kind: 'dry' | 'starts' | 'stops' | 'continues';
  /** start of the change ('…T15:30') */
  at?: string;
  snow: boolean;
  /** mm in the two hours */
  total: number;
}

/** below this a quarter counts as dry (the model's smallest step is 0.1 mm) */
const WET = 0.1;

/** What the next two hours bring, from the 15-minute nowcast. */
export function nowcast(quarters: Quarter[] | null, now: Date): Nowcast | null {
  if (!quarters) return null;
  const from = localIso(new Date(Math.floor(now.getTime() / 900_000) * 900_000));
  const slots = quarters.filter((q) => q.time >= from).slice(0, 8);
  if (slots.length < 4) return null;
  const wet = slots.map((q) => q.rain >= WET || q.snow > 0);
  const snow = slots.some((q) => q.snow > 0);
  const total = Math.round(slots.reduce((s, q) => s + q.rain, 0) * 10) / 10;
  if (!wet.includes(true)) return { slots, kind: 'dry', snow, total };
  if (wet[0]) {
    const dry = wet.indexOf(false);
    return dry === -1 ? { slots, kind: 'continues', snow, total } : { slots, kind: 'stops', at: slots[dry].time, snow, total };
  }
  return { slots, kind: 'starts', at: slots[wet.indexOf(true)].time, snow, total };
}

/** air quality of the hour `time` ('…T15:00'); null beyond the air quality forecast (4 days) */
export function airAt(air: AirHour[] | null, time: string): AirHour | null {
  return air?.find((a) => a.time.slice(0, 13) === time.slice(0, 13)) ?? null;
}
