import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorage } from '../test/fakeStorage';
import { expandLocalEvents, parseYmd, toYmd, type LocalEvent } from './localEvents';

const ev = (over: Partial<LocalEvent>): LocalEvent => ({
  id: 'e1',
  title: 'Fußball',
  date: '2026-11-10',
  allDay: true,
  repeat: 'none',
  memberIds: ['m1'],
  createdAt: 1000,
  ...over,
});

describe('expandLocalEvents', () => {
  it('expands single, multi-day all-day, and timed events', () => {
    const items: LocalEvent[] = [
      ev({ id: 'a', title: 'Ausflug', date: '2026-11-10', endDate: '2026-11-12', allDay: true }),
      ev({ id: 'b', title: 'Zahnarzt', date: '2026-11-11', allDay: false, startTime: '15:30', endTime: '16:15' }),
    ];
    const out = expandLocalEvents(items, { start: new Date(2026, 10, 9), end: new Date(2026, 10, 15) });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ localId: 'a', allDay: true });
    expect(toYmd(out[0].start)).toBe('2026-11-10');
    expect(toYmd(out[0].end)).toBe('2026-11-13'); // exclusive end
    expect(out[1]).toMatchObject({ localId: 'b', allDay: false });
    expect(out[1].start.getHours()).toBe(15);
    expect(out[1].start.getMinutes()).toBe(30);
    expect(out[1].end.getHours()).toBe(16);
    expect(out[1].end.getMinutes()).toBe(15);
  });

  it('expands weekly, monthly (clamping month end), and yearly (clamping Feb 29) repeats', () => {
    const items: LocalEvent[] = [
      ev({ id: 'w', title: 'Training', date: '2026-11-03', repeat: 'weekly' }),
      ev({ id: 'm', title: 'Miete', date: '2026-01-31', repeat: 'monthly' }),
      ev({ id: 'y', title: 'Schalttag', date: '2024-02-29', repeat: 'yearly' }),
    ];

    const weekly = expandLocalEvents([items[0]], { start: new Date(2026, 10, 1), end: new Date(2026, 10, 25) });
    expect(weekly.map((x) => toYmd(x.start))).toEqual(['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);

    const monthly = expandLocalEvents([items[1]], { start: new Date(2026, 1, 1), end: new Date(2026, 4, 1) });
    expect(monthly.map((x) => toYmd(x.start))).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);

    const yearly = expandLocalEvents([items[2]], { start: new Date(2025, 0, 1), end: new Date(2029, 0, 1) });
    expect(yearly.map((x) => toYmd(x.start))).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('filters memberIds against valid members and drops events without any remaining member', () => {
    const items: LocalEvent[] = [ev({ id: '1', memberIds: ['m1', 'm2'] }), ev({ id: '2', memberIds: ['gone'] })];
    const out = expandLocalEvents(items, { start: parseYmd('2026-11-01'), end: parseYmd('2026-11-20') }, new Set(['m1']));
    expect(out).toHaveLength(1);
    expect(out[0].memberIds).toEqual(['m1']);
  });
});

describe('localEvents store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', fakeStorage());
  });

  it('prunes deleted family members and removes orphaned events', async () => {
    const mod = await import('./localEvents');
    mod.upsertLocalEvent(ev({ id: 'shared', memberIds: ['m1', 'm2'] }));
    mod.upsertLocalEvent(ev({ id: 'only-m2', memberIds: ['m2'] }));

    mod.pruneLocalEventsMember('m2');
    expect(mod.localEvents.get().map((x) => [x.id, x.memberIds])).toEqual([['shared', ['m1']]]);
  });
});
