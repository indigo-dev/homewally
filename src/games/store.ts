import { isRecord, persisted, usePersisted } from '../lib/persisted';
import { dayKey } from '../lib/dates';

/*
 * The games corner, per device (it is about this tablet's screen time, not the family's data) – on by default:
 * switched on or off, an optional daily limit and opening hours, today's play time, records per
 * player, and who played last.
 */

export type GameId = 'mines' | 'tiles' | 'gems' | 'paddle';
export const GAME_IDS: GameId[] = ['mines', 'tiles', 'gems', 'paddle'];

export interface GamesSettings {
  enabled: boolean;
  /** minutes per day, 0 = no limit */
  dailyMinutes: number;
  /** opening hours [from, to) – 0 and 24 = always open */
  from: number;
  to: number;
}

const int = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** stored settings → valid settings; the corner is on unless it was switched off */
export function parseGamesSettings(raw: unknown): GamesSettings {
  const v = isRecord(raw) ? raw : {};
  return {
    enabled: v.enabled !== false,
    dailyMinutes: int(v.dailyMinutes, 0, 0, 240),
    from: int(v.from, 0, 0, 23),
    to: int(v.to, 24, 1, 24),
  };
}

export const gamesSettingsStore = persisted<GamesSettings>('fc.games', parseGamesSettings, { syncTabs: false });
const settingsStore = gamesSettingsStore;
export const useGamesSettings = () => usePersisted(settingsStore);
export const updateGamesSettings = (patch: Partial<GamesSettings>) => settingsStore.set((s) => ({ ...s, ...patch }));

/* ---------------- play time today */

const usageStore = persisted<{ date: string; seconds: number }>(
  'fc.games.usage',
  (raw) => {
    const v = isRecord(raw) ? raw : {};
    return { date: typeof v.date === 'string' ? v.date : '', seconds: int(v.seconds, 0, 0, 86400) };
  },
  { syncTabs: false },
);

export function addPlaySeconds(seconds: number, now = new Date()) {
  const today = dayKey(now);
  usageStore.set((u) => ({ date: today, seconds: (u.date === today ? u.seconds : 0) + seconds }));
}

export function usePlayedToday(now: Date): number {
  const u = usePersisted(usageStore);
  return u.date === dayKey(now) ? u.seconds : 0;
}

export type Gate = { open: true; minutesLeft: number | null } | { open: false; reason: 'hours' | 'time' };

/** Is the corner open right now? (limits off: always) */
export function gate(s: GamesSettings, now: Date, playedSeconds: number): Gate {
  const h = now.getHours();
  const always = s.from === 0 && s.to === 24;
  const inHours = always || (s.from < s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to);
  if (!inHours) return { open: false, reason: 'hours' };
  if (s.dailyMinutes > 0) {
    const left = Math.ceil((s.dailyMinutes * 60 - playedSeconds) / 60);
    if (left <= 0) return { open: false, reason: 'time' };
    return { open: true, minutesLeft: left };
  }
  return { open: true, minutesLeft: null };
}

/* ---------------- players and records */

export const GUEST = 'guest';

const playerStore = persisted<string>('fc.games.player', (raw) => (typeof raw === 'string' ? raw : GUEST), { syncTabs: false });
export const usePlayer = () => usePersisted(playerStore);
export const setPlayer = (id: string) => playerStore.set(id);

/** best value per record key ('mines:easy', 'gems', …) and player */
type Records = Record<string, Record<string, number>>;
export const gamesRecordsStore = persisted<Records>(
  'fc.games.records',
  (raw) => {
    const out: Records = {};
    if (!isRecord(raw)) return out;
    for (const [key, byPlayer] of Object.entries(raw)) {
      if (!isRecord(byPlayer)) continue;
      out[key] = {};
      for (const [p, v] of Object.entries(byPlayer)) if (typeof v === 'number' && Number.isFinite(v)) out[key][p] = v;
    }
    return out;
  },
  { syncTabs: false },
);
const recordsStore = gamesRecordsStore;
export const useRecords = () => usePersisted(recordsStore);

/**
 * Saves a result if it beats the player's record. `lowerIsBetter`: times (minefield, tile pairs);
 * otherwise points / wins. Returns true for a new record.
 */
export function submitResult(key: string, player: string, value: number, lowerIsBetter: boolean): boolean {
  const best = recordsStore.get()[key]?.[player];
  const better = best === undefined || (lowerIsBetter ? value < best : value > best);
  if (better) recordsStore.set((r) => ({ ...r, [key]: { ...r[key], [player]: value } }));
  return better;
}

/** "1:23" for seconds */
export const clockTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
