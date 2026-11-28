import { describe, expect, it } from 'vitest';
import type { CalEvent } from '../types';
import { DEFAULT_SOUND_SETTINGS, isQuietTime, parseSoundSettings } from './sounds';
import { dueReminders } from '../components/EventReminders';

describe('soundSettings & quiet hours', () => {
  it('normalises invalid stored values to safe defaults', () => {
    expect(parseSoundSettings(undefined)).toEqual(DEFAULT_SOUND_SETTINGS);
    const parsed = parseSoundSettings({ volume: 99, reminderMinutes: 7, quietFrom: 25, reminderSpeak: true });
    expect(parsed.volume).toBe(DEFAULT_SOUND_SETTINGS.volume);
    expect(parsed.reminderMinutes).toBe(DEFAULT_SOUND_SETTINGS.reminderMinutes);
    expect(parsed.quietFrom).toBe(DEFAULT_SOUND_SETTINGS.quietFrom);
    expect(parsed.reminderSpeak).toBe(true);
  });

  it('handles overnight and daytime quiet hours accurately', () => {
    const overnight = { quietEnabled: true, quietFrom: 21, quietTo: 7 };
    expect(isQuietTime(overnight, new Date(2026, 10, 28, 22, 0))).toBe(true);
    expect(isQuietTime(overnight, new Date(2026, 10, 28, 6, 59))).toBe(true);
    expect(isQuietTime(overnight, new Date(2026, 10, 28, 7, 0))).toBe(false);
    expect(isQuietTime(overnight, new Date(2026, 10, 28, 15, 0))).toBe(false);

    const daytime = { quietEnabled: true, quietFrom: 13, quietTo: 15 };
    expect(isQuietTime(daytime, new Date(2026, 10, 28, 14, 0))).toBe(true);
    expect(isQuietTime(daytime, new Date(2026, 10, 28, 15, 0))).toBe(false);

    expect(isQuietTime({ quietEnabled: false, quietFrom: 21, quietTo: 7 }, new Date(2026, 10, 28, 23, 0))).toBe(false);
  });
});

describe('dueReminders', () => {
  const mk = (key: string, start: Date, allDay = false): CalEvent => ({
    key,
    title: key,
    start,
    end: new Date(start.getTime() + 3600_000),
    allDay,
    memberIds: ['m1'],
  });

  it('triggers only for unseen timed events inside the lead window', () => {
    const now = new Date(2026, 10, 28, 14, 45);
    const events: CalEvent[] = [
      mk('allday', new Date(2026, 10, 28, 0, 0), true),
      mk('past', new Date(2026, 10, 28, 14, 30)),
      mk('now', new Date(2026, 10, 28, 14, 45)),
      mk('soon', new Date(2026, 10, 28, 15, 0)),
      mk('seen', new Date(2026, 10, 28, 14, 55)),
      mk('later', new Date(2026, 10, 28, 15, 30)),
    ];

    const due = dueReminders(events, now, 15, new Set(['seen']));
    expect(due.map((e) => e.key)).toEqual(['now', 'soon']);
  });
});
