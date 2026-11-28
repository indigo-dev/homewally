import { useEffect, useSyncExternalStore } from 'react';
import { getBattery, isNative, onBatteryChanged, type BatteryStatus } from '../native/launcher';
import { arrayOf, isRecord, persisted, usePersisted } from './persisted';

const HISTORY_KEY = 'fc.batteryHistory';
export const HISTORY_WINDOW_MS = 24 * 60 * 60_000;
const MIN_SAMPLE_INTERVAL_MS = 10 * 60_000;
const MAX_SAMPLES = 300;
/** gap larger than this is drawn as a dashed bridge instead of a filled segment */
const GAP_MS = 45 * 60_000;

export interface BatterySample {
  /** epoch ms */
  t: number;
  /** 0..100 */
  level: number;
  charging: boolean;
}

const isSample = (v: unknown): v is BatterySample =>
  isRecord(v) &&
  typeof v.t === 'number' &&
  Number.isFinite(v.t) &&
  typeof v.level === 'number' &&
  v.level >= 0 &&
  v.level <= 100 &&
  typeof v.charging === 'boolean';

export const batteryHistory = persisted<BatterySample[]>(HISTORY_KEY, (raw) => arrayOf(raw, isSample));

/** Appends a sample to the 24-hour history (deduplicating steady readings within 10 minutes). */
export function appendBatterySample(
  cur: BatterySample[],
  status: Pick<BatteryStatus, 'level' | 'charging'>,
  now = Date.now(),
): BatterySample[] {
  const cutoff = now - HISTORY_WINDOW_MS;
  const fresh = cur.filter((s) => s.t >= cutoff && s.t <= now + 60_000);
  const last = fresh[fresh.length - 1];
  if (last && last.level === status.level && last.charging === status.charging && now - last.t < MIN_SAMPLE_INTERVAL_MS) {
    return fresh;
  }
  const next = [...fresh, { t: now, level: Math.round(status.level), charging: status.charging }];
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
}

export type BatteryTone = 'good' | 'warn' | 'low';

/** Colour coding for the battery level: ≥ 50 % green, 20–49 % amber, < 20 % red. */
export function batteryTone(level: number): BatteryTone {
  if (level < 20) return 'low';
  if (level < 50) return 'warn';
  return 'good';
}

/* ------------------------------------------------------------------ live status store */

let currentStatus: BatteryStatus | null = null;
const statusListeners = new Set<() => void>();

function setLiveStatus(status: BatteryStatus) {
  currentStatus = status;
  batteryHistory.set((cur) => appendBatterySample(cur, status));
  statusListeners.forEach((l) => l());
}

const subscribeStatus = (l: () => void) => {
  statusListeners.add(l);
  return () => statusListeners.delete(l);
};
const getLiveStatus = () => currentStatus;

/**
 * Starts native battery monitoring once at app root so the 24h curve keeps recording
 * regardless of which module is currently open. No-op on the web.
 */
export function useBatteryMonitor(): void {
  useEffect(() => {
    if (!isNative) return;
    const poll = () => {
      void getBattery().then((s) => {
        if (s) setLiveStatus(s);
      });
    };
    poll();
    const off = onBatteryChanged(setLiveStatus);
    const timer = window.setInterval(poll, MIN_SAMPLE_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
}

export function useBattery(): { status: BatteryStatus | null; history: BatterySample[] } {
  const status = useSyncExternalStore(subscribeStatus, getLiveStatus);
  const history = usePersisted(batteryHistory);
  return { status, history };
}

/* ------------------------------------------------------------------ SVG chart geometry */

export interface ChartPoint {
  x: number;
  y: number;
  level: number;
  charging: boolean;
  t: number;
}

export interface ChartSegment {
  line: string;
  area: string;
  points: ChartPoint[];
}

export interface BatteryChart {
  segments: ChartSegment[];
  bridges: string[];
  last: ChartPoint;
  startMs: number;
  endMs: number;
  spanHours: number;
}

/** Projects recorded battery samples onto an SVG viewport (with dashed bridges across offline gaps). */
export function buildBatteryChart(
  samples: BatterySample[],
  nowMs: number,
  width: number,
  height: number,
  padX = 4,
  padY = 6,
): BatteryChart | null {
  const cutoff = nowMs - HISTORY_WINDOW_MS;
  const recent = samples.filter((s) => s.t >= cutoff && s.t <= nowMs + 60_000).sort((a, b) => a.t - b.t);
  if (recent.length < 2) return null;

  const spanMs = Math.max(60 * 60_000, Math.min(HISTORY_WINDOW_MS, nowMs - recent[0].t));
  const startMs = nowMs - spanMs;
  const innerW = Math.max(1, width - 2 * padX);
  const innerH = Math.max(1, height - 2 * padY);
  const baseY = padY + innerH;

  const project = (s: BatterySample): ChartPoint => {
    const ratio = Math.max(0, Math.min(1, (s.t - startMs) / spanMs));
    return {
      x: Math.round((padX + ratio * innerW) * 10) / 10,
      y: Math.round((padY + (1 - s.level / 100) * innerH) * 10) / 10,
      level: s.level,
      charging: s.charging,
      t: s.t,
    };
  };

  const groups: ChartPoint[][] = [];
  for (const s of recent) {
    const pt = project(s);
    const cur = groups[groups.length - 1];
    if (!cur || s.t - cur[cur.length - 1].t > GAP_MS) groups.push([pt]);
    else cur.push(pt);
  }

  const segments: ChartSegment[] = groups.map((pts) => {
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const area = pts.length >= 2 ? `${line} L${pts[pts.length - 1].x},${baseY} L${pts[0].x},${baseY} Z` : '';
    return { line, area, points: pts };
  });

  const bridges: string[] = [];
  for (let i = 1; i < groups.length; i++) {
    const a = groups[i - 1][groups[i - 1].length - 1];
    const b = groups[i][0];
    bridges.push(`M${a.x},${a.y} L${b.x},${b.y}`);
  }

  const lastGroup = groups[groups.length - 1];
  return {
    segments,
    bridges,
    last: lastGroup[lastGroup.length - 1],
    startMs,
    endMs: nowMs,
    spanHours: Math.max(1, Math.round(spanMs / 3_600_000)),
  };
}
