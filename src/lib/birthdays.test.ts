import { describe, expect, it } from 'vitest';
import { expandBirthdays, type Birthday } from './birthdays';
import { toYmd } from './localEvents';

const bday = (over: Partial<Birthday>): Birthday => ({
  id: 'b1',
  name: 'Oma Hilde',
  month: 5,
  day: 14,
  createdAt: 1000,
  ...over,
});

describe('expandBirthdays', () => {
  it('creates unassigned all-day yearly events and computes turning age when birth year is given', () => {
    const items: Birthday[] = [
      bday({ id: 'with-year', name: 'Oma Hilde', month: 5, day: 14, year: 1956 }),
      bday({ id: 'no-year', name: 'Paul', month: 5, day: 20 }),
    ];
    const out = expandBirthdays(items, { start: new Date(2026, 4, 1), end: new Date(2026, 5, 1) });
    expect(out).toHaveLength(2);

    const oma = out.find((e) => e.birthdayId === 'with-year')!;
    expect(oma.allDay).toBe(true);
    expect(oma.memberIds).toEqual([]);
    expect(oma.birthdayAge).toBe(70);
    expect(oma.title).toContain('70');
    expect(toYmd(oma.start)).toBe('2026-05-14');
    expect(toYmd(oma.end)).toBe('2026-05-15');

    const paul = out.find((e) => e.birthdayId === 'no-year')!;
    expect(paul.birthdayAge).toBeUndefined();
    expect(paul.memberIds).toEqual([]);
    expect(toYmd(paul.start)).toBe('2026-05-20');
  });

  it('clamps Feb 29 birthdays to Feb 28 in non-leap years and keeps Feb 29 in leap years', () => {
    const leap = [bday({ id: 'leap', name: 'Leo', month: 2, day: 29, year: 2020 })];
    const out = expandBirthdays(leap, { start: new Date(2026, 0, 1), end: new Date(2029, 0, 1) });
    expect(out.map((e) => [toYmd(e.start), e.birthdayAge])).toEqual([
      ['2026-02-28', 6],
      ['2027-02-28', 7],
      ['2028-02-29', 8],
    ]);
  });
});
