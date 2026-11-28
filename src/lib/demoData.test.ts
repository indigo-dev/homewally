import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorage } from '../test/fakeStorage';
import type { WidgetType } from './dashboard';

// photos live in IndexedDB, which node lacks – the frame's photo functions are replaced
const frame = vi.hoisted(() => ({
  addDemoPhotos: vi.fn(async (ids: string[]) => ids.length),
  removeDemoPhotos: vi.fn(async () => {}),
  deletePhotoDatabase: vi.fn(async () => {}),
  usePhotos: () => [],
}));
vi.mock('./frame', () => frame);

/** fresh stores on a fresh localStorage (optionally prefilled) for every test */
async function load(stored: Record<string, unknown> = {}) {
  vi.stubGlobal('localStorage', fakeStorage());
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, JSON.stringify(v));
  vi.resetModules();
  const [demoData, config, todos, shopping, weather, demo, id, i18n] = await Promise.all([
    import('./demoData'),
    import('./config'),
    import('./todos'),
    import('./shopping'),
    import('./weather'),
    import('./demo'),
    import('./id'),
    import('../i18n'),
  ]);
  return { ...demoData, config, todos: todos.todos, shopping: shopping.shopping, weather: weather.weatherSettings, demo, id, i18n };
}

const TODAY = new Date(2026, 10, 23); // a Monday
const WEEK = { start: TODAY, end: new Date(2026, 10, 30) };

beforeEach(() => {
  vi.unstubAllGlobals();
  Object.values(frame).forEach((f) => 'mockClear' in f && f.mockClear());
});

describe('demo family', () => {
  it('fills every dashboard widget and module', async () => {
    const s = await load();
    s.i18n.setLanguage('de');
    const { members } = s.loadDemo(TODAY);
    const cfg = s.config.configStore.get();
    const events = s.demo.demoEvents(cfg.members, WEEK);
    const ids = new Set(members.map((m) => m.id));

    // every widget type needs a check here – a new widget without demo content fails to compile
    const filled: Record<WidgetType, boolean> = {
      clock: true,
      events: events.length > 0,
      family: cfg.members.length === 4 && cfg.members.every((m) => events.some((e) => e.memberIds.includes(m.id))),
      weather: s.weather.get().places.length > 0,
      pollen: s.weather.get().places.length > 0,
      timetable: cfg.members.filter((m) => m.timetable).length === 2,
      todos: s.todos.get().filter((t) => !t.done).length > 0,
      shopping: s.shopping.get().list.length > 0,
      photos: frame.addDemoPhotos.mock.calls[0]?.[0].length > 0,
      holidays: cfg.settings.holidays.region !== '',
      // Android-only hardware/app widgets: nothing to fill with demo data
      app: true,
      battery: true,
    };
    expect(Object.entries(filled).filter(([, ok]) => !ok)).toEqual([]);

    // everything the demo made is marked
    expect(cfg.members.every((m) => s.id.isDemoId(m.id))).toBe(true);
    expect(s.todos.get().every((t) => s.id.isDemoId(t.id) && t.memberIds.length > 0 && t.memberIds.every((x) => ids.has(x)))).toBe(true);
    // every person has at least one note
    members.forEach((m) => expect(s.todos.get().some((t) => t.memberIds.includes(m.id))).toBe(true));
    expect(s.shopping.get().list.every((e) => e.demo)).toBe(true);
    expect(s.weather.get().places.every((p) => s.id.isDemoId(p.id))).toBe(true);
    expect(s.shopping.get().bought.milk).toBeGreaterThan(0);
    expect(s.todos.get()[0].text).toBe('Steuererklärung abschicken');
  });

  it('writes its texts in the active language', async () => {
    const s = await load();
    s.i18n.setLanguage('en');
    s.loadDemo(TODAY);
    expect(s.todos.get()[0].text).toBe('Send off the tax return');
    expect(s.config.configStore.get().members[0].name).toBe('Dad');
    s.i18n.setLanguage('de');
  });

  it('does not touch the region and places the family already chose', async () => {
    const own = { id: 'own', name: 'Home', lat: 50, lon: 8 };
    const s = await load({ 'fc.weather': { places: [own], activeId: 'own' } });
    s.config.configStore.set((c) => ({ ...c, settings: { ...c.settings, holidays: { ...c.settings.holidays, region: 'DE-HE' } } }));
    s.loadDemo(TODAY);
    expect(s.config.configStore.get().settings.holidays.region).toBe('DE-HE');
    expect(s.weather.get().places).toEqual([own]);
    await s.removeDemo();
    expect(s.config.configStore.get().settings.holidays.region).toBe('DE-HE');
    expect(s.weather.get().places).toEqual([own]);
  });
});

describe('remove demo data', () => {
  it('deletes exactly the demo records and keeps the family’s own', async () => {
    const s = await load();
    // own data before the demo
    const me = { ...s.config.newMember([]), id: 'me', name: 'Anna', demo: true as const };
    const cal = s.config.newCalendar('Arbeit', 'https://example.org/a.ics', ['me']);
    s.config.configStore.set((c) => ({ ...c, members: [me], calendars: [cal] }));
    s.todos.set([{ id: 'own-todo', text: 'Mine', memberIds: ['me'], done: false, createdAt: 1 }]);
    s.shopping.set((st) => ({ ...st, list: [{ itemId: 'milk', qty: 3, addedAt: 1 }], bought: { milk: 2, flour: 1 } }));

    const { members } = s.loadDemo(TODAY);
    // the family assigns its calendar to a demo person too
    s.config.configStore.set((c) => ({ ...c, calendars: c.calendars.map((x) => ({ ...x, memberIds: [...x.memberIds, members[0].id] })) }));
    expect(s.hasDemoData(s.demoSummary())).toBe(true);

    await s.removeDemo();
    const cfg = s.config.configStore.get();
    expect(cfg.members.map((m) => m.id)).toEqual(['me']);
    // own people stop showing sample events
    expect(cfg.members[0].demo).toBeUndefined();
    expect(s.demo.demoEvents(cfg.members, WEEK)).toEqual([]);
    expect(cfg.calendars).toEqual([{ ...cal, memberIds: ['me'] }]);
    expect(cfg.settings.holidays.region).toBe('');
    expect(s.todos.get().map((t) => t.id)).toEqual(['own-todo']);
    // milk was already on the list – the demo did not add it, so it stays
    expect(s.shopping.get().list).toEqual([{ itemId: 'milk', qty: 3, addedAt: 1 }]);
    expect(s.shopping.get().bought).toEqual({ milk: 2, flour: 1 });
    expect(s.weather.get().places).toEqual([]);
    expect(frame.removeDemoPhotos).toHaveBeenCalledOnce();
    expect(s.hasDemoData(s.demoSummary())).toBe(false);
  });

  it('can load the demo again after removing it', async () => {
    const s = await load();
    s.loadDemo(TODAY);
    s.loadDemo(TODAY);
    expect(s.config.configStore.get().members).toHaveLength(4);
    expect(s.todos.get().length).toBe(s.demoSummary().todos);
    await s.removeDemo();
    s.loadDemo(TODAY);
    expect(s.demoSummary()).toMatchObject({ members: 4, places: 1, settings: true });
    expect(s.shopping.get().bought.milk).toBe(6);
  });
});

describe('reset the app', () => {
  it('deletes every stored value and the photos, so the next start is the first start', async () => {
    const s = await load({ 'fc.dashboard': [], 'fc.moduleOrder': ['todos'], 'fc.frame': { intervalSec: 10 }, 'msal.token': 'x', other: 1 });
    s.loadDemo(TODAY);
    localStorage.setItem('fc.events.cache.x', '[]');

    await s.resetApp();
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    expect(keys).toEqual(['other']);
    expect(localStorage.getItem('other')).toBe('1');
    expect(frame.deletePhotoDatabase).toHaveBeenCalledOnce();

    // a reload starts every store from its defaults
    vi.resetModules();
    const [config, todos, shopping, weather] = await Promise.all([
      import('./config'),
      import('./todos'),
      import('./shopping'),
      import('./weather'),
    ]);
    expect(config.configStore.get()).toEqual(config.defaultConfig());
    expect(todos.todos.get()).toEqual([]);
    expect(shopping.shopping.get().list).toEqual([]);
    expect(weather.weatherSettings.get().places).toEqual([]);
  });
});
