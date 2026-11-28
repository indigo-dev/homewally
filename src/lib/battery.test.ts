import { describe, expect, it } from 'vitest';
import { appendBatterySample, batteryTone, buildBatteryChart, HISTORY_WINDOW_MS, type BatterySample } from './battery';

describe('battery helpers', () => {
  it('maps battery level to good / warn / low tones', () => {
    expect(batteryTone(100)).toBe('good');
    expect(batteryTone(50)).toBe('good');
    expect(batteryTone(49)).toBe('warn');
    expect(batteryTone(20)).toBe('warn');
    expect(batteryTone(19)).toBe('low');
    expect(batteryTone(0)).toBe('low');
  });

  it('appends samples, deduplicates steady readings under 10 min, and prunes >24h history', () => {
    const t0 = 1_700_000_000_000;
    const old: BatterySample = { t: t0 - HISTORY_WINDOW_MS - 1000, level: 90, charging: false };
    const s1 = appendBatterySample([old], { level: 80, charging: false }, t0);
    expect(s1).toEqual([{ t: t0, level: 80, charging: false }]);

    // same level & state 2 minutes later → skipped
    const s2 = appendBatterySample(s1, { level: 80, charging: false }, t0 + 2 * 60_000);
    expect(s2).toHaveLength(1);

    // level changed 2 minutes later → recorded
    const s3 = appendBatterySample(s2, { level: 79, charging: false }, t0 + 2 * 60_000);
    expect(s3).toHaveLength(2);

    // same level 11 minutes later → recorded to keep timeline alive
    const s4 = appendBatterySample(s3, { level: 79, charging: false }, t0 + 13 * 60_000);
    expect(s4).toHaveLength(3);
  });

  it('builds chart segments and dashed bridges across offline gaps', () => {
    const now = 1_700_000_000_000;
    const h = 3_600_000;
    const samples: BatterySample[] = [
      { t: now - 4 * h, level: 90, charging: false },
      { t: now - 3.5 * h, level: 82, charging: false },
      // 3 hour offline gap (> 45 min)
      { t: now - 0.5 * h, level: 40, charging: true },
      { t: now, level: 75, charging: true },
    ];
    const chart = buildBatteryChart(samples, now, 200, 80);
    expect(chart).not.toBeNull();
    expect(chart!.segments).toHaveLength(2);
    expect(chart!.bridges).toHaveLength(1);
    expect(chart!.last.level).toBe(75);
    expect(chart!.spanHours).toBe(4);
  });
});
