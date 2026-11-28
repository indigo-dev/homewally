import { isRecord, numberIn, oneOf, persisted, usePersisted } from './persisted';

const KEY = 'fc.sounds';

export const REMINDER_LEADS = [0, 5, 10, 15, 30] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];

export interface SoundSettings {
  /** master switch for all synthesized sounds */
  enabled: boolean;
  /** 0.1 .. 1.0 */
  volume: number;
  /** UI action cues (to-dos, shopping, local events, voice) */
  actions: boolean;
  /** Games corner cues (hits, matches, wins, records) */
  games: boolean;
  /** silence sounds and spoken reminders during night/quiet hours */
  quietEnabled: boolean;
  /** 0..23 */
  quietFrom: number;
  /** 0..23 */
  quietTo: number;
  /** show a visual reminder banner before timed calendar events */
  remindersEnabled: boolean;
  /** minutes before event start (0 = at start) */
  reminderMinutes: ReminderLead;
  /** play the calm chime when an event reminder appears */
  reminderSound: boolean;
  /** optional: read the upcoming event aloud */
  reminderSpeak: boolean;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.55,
  actions: true,
  games: true,
  quietEnabled: true,
  quietFrom: 21,
  quietTo: 7,
  remindersEnabled: true,
  reminderMinutes: 15,
  reminderSound: true,
  reminderSpeak: false,
};

const hour = (v: unknown, fallback: number) => Math.round(numberIn(v, 0, 23, fallback));

export function parseSoundSettings(raw: unknown): SoundSettings {
  const v = isRecord(raw) ? raw : {};
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_SOUND_SETTINGS.enabled,
    volume: Math.round(numberIn(v.volume, 0.1, 1, DEFAULT_SOUND_SETTINGS.volume) * 100) / 100,
    actions: typeof v.actions === 'boolean' ? v.actions : DEFAULT_SOUND_SETTINGS.actions,
    games: typeof v.games === 'boolean' ? v.games : DEFAULT_SOUND_SETTINGS.games,
    quietEnabled: typeof v.quietEnabled === 'boolean' ? v.quietEnabled : DEFAULT_SOUND_SETTINGS.quietEnabled,
    quietFrom: hour(v.quietFrom, DEFAULT_SOUND_SETTINGS.quietFrom),
    quietTo: hour(v.quietTo, DEFAULT_SOUND_SETTINGS.quietTo),
    remindersEnabled: typeof v.remindersEnabled === 'boolean' ? v.remindersEnabled : DEFAULT_SOUND_SETTINGS.remindersEnabled,
    reminderMinutes: oneOf(v.reminderMinutes, REMINDER_LEADS, DEFAULT_SOUND_SETTINGS.reminderMinutes),
    reminderSound: typeof v.reminderSound === 'boolean' ? v.reminderSound : DEFAULT_SOUND_SETTINGS.reminderSound,
    reminderSpeak: typeof v.reminderSpeak === 'boolean' ? v.reminderSpeak : DEFAULT_SOUND_SETTINGS.reminderSpeak,
  };
}

export const soundSettings = persisted<SoundSettings>(KEY, parseSoundSettings);
export const useSoundSettings = () => usePersisted(soundSettings);
export const updateSoundSettings = (patch: Partial<SoundSettings>) => soundSettings.set((s) => ({ ...s, ...patch }));

/** True if `now` falls inside the configured quiet hours (supports overnight ranges like 21 → 7). */
export function isQuietTime(s: Pick<SoundSettings, 'quietEnabled' | 'quietFrom' | 'quietTo'>, now = new Date()): boolean {
  if (!s.quietEnabled || s.quietFrom === s.quietTo) return false;
  const h = now.getHours();
  return s.quietFrom < s.quietTo ? h >= s.quietFrom && h < s.quietTo : h >= s.quietFrom || h < s.quietTo;
}

/* ------------------------------------------------------------------ Web Audio synthesizer */

export type SoundName =
  | 'todoDone'
  | 'shopPop'
  | 'eventSaved'
  | 'voiceStart'
  | 'voiceOk'
  | 'voiceError'
  | 'gameHit'
  | 'gameMatch'
  | 'gameWin'
  | 'gameRecord'
  | 'gameLose'
  | 'reminder';

type Category = 'actions' | 'games' | 'reminder';

const CATEGORY: Record<SoundName, Category> = {
  todoDone: 'actions',
  shopPop: 'actions',
  eventSaved: 'actions',
  voiceStart: 'actions',
  voiceOk: 'actions',
  voiceError: 'actions',
  gameHit: 'games',
  gameMatch: 'games',
  gameWin: 'games',
  gameRecord: 'games',
  gameLose: 'games',
  reminder: 'reminder',
};

interface Note {
  /** frequency in Hz */
  f: number;
  /** start offset in seconds */
  at: number;
  /** decay duration in seconds */
  dur: number;
  /** relative amplitude 0..1 */
  gain?: number;
  type?: OscillatorType;
}

/** Soft, warm marimba/bell-like tone recipes (no harsh square/sawtooth beeps). */
const RECIPES: Record<SoundName, Note[]> = {
  todoDone: [
    { f: 523.25, at: 0, dur: 0.16, gain: 0.7 },
    { f: 783.99, at: 0.085, dur: 0.28, gain: 0.85 },
  ],
  shopPop: [{ f: 659.25, at: 0, dur: 0.085, gain: 0.5, type: 'triangle' }],
  eventSaved: [
    { f: 587.33, at: 0, dur: 0.14, gain: 0.65 },
    { f: 739.99, at: 0.08, dur: 0.24, gain: 0.75 },
  ],
  voiceStart: [
    { f: 440, at: 0, dur: 0.12, gain: 0.55 },
    { f: 587.33, at: 0.07, dur: 0.2, gain: 0.65 },
  ],
  voiceOk: [
    { f: 659.25, at: 0, dur: 0.12, gain: 0.55 },
    { f: 880, at: 0.075, dur: 0.22, gain: 0.7 },
  ],
  voiceError: [
    { f: 311.13, at: 0, dur: 0.14, gain: 0.55, type: 'triangle' },
    { f: 261.63, at: 0.11, dur: 0.2, gain: 0.5, type: 'triangle' },
  ],
  gameHit: [{ f: 740, at: 0, dur: 0.06, gain: 0.35, type: 'triangle' }],
  gameMatch: [
    { f: 659.25, at: 0, dur: 0.11, gain: 0.55 },
    { f: 987.77, at: 0.065, dur: 0.2, gain: 0.65 },
  ],
  gameWin: [
    { f: 523.25, at: 0, dur: 0.16, gain: 0.65 },
    { f: 659.25, at: 0.1, dur: 0.16, gain: 0.7 },
    { f: 783.99, at: 0.2, dur: 0.34, gain: 0.8 },
  ],
  gameRecord: [
    { f: 523.25, at: 0, dur: 0.14, gain: 0.6 },
    { f: 659.25, at: 0.085, dur: 0.14, gain: 0.65 },
    { f: 783.99, at: 0.17, dur: 0.16, gain: 0.75 },
    { f: 1046.5, at: 0.26, dur: 0.42, gain: 0.85 },
  ],
  gameLose: [
    { f: 349.23, at: 0, dur: 0.18, gain: 0.5, type: 'triangle' },
    { f: 261.63, at: 0.14, dur: 0.28, gain: 0.5, type: 'triangle' },
  ],
  reminder: [
    { f: 392.0, at: 0, dur: 0.45, gain: 0.75 },
    { f: 523.25, at: 0.18, dur: 0.65, gain: 0.85 },
  ],
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/** Plays a soft synthesized cue if allowed by the user's sound settings and quiet hours. */
export function playSound(name: SoundName, opts?: { force?: boolean; now?: Date }): void {
  const s = soundSettings.get();
  if (!opts?.force) {
    if (!s.enabled) return;
    if (isQuietTime(s, opts?.now)) return;
    const cat = CATEGORY[name];
    if (cat === 'actions' && !s.actions) return;
    if (cat === 'games' && !s.games) return;
    if (cat === 'reminder' && !s.reminderSound) return;
  }

  const ctx = getAudioContext();
  if (!ctx) return;

  const render = () => {
    const base = ctx.currentTime + 0.01;
    // keep max amplitude gentle so it feels warm even on loud tablets
    const master = Math.max(0.02, Math.min(1, s.volume)) * 0.24;
    for (const n of RECIPES[name]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.type ?? 'sine';
      osc.frequency.setValueAtTime(n.f, base + n.at);

      const peak = master * (n.gain ?? 0.7);
      const t0 = base + n.at;
      const attack = 0.008;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);

      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + n.dur + 0.02);
    }
  };

  if (ctx.state === 'suspended') {
    ctx
      .resume()
      .then(render)
      .catch(() => {});
  } else {
    render();
  }
}
