import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorage } from '../test/fakeStorage';
import { defaultConfig } from './config';
import { DEFAULT_PERIODS } from './school';

async function loadModules() {
  vi.resetModules();
  vi.stubGlobal('localStorage', fakeStorage());
  const [backup, todosMod, localMod, shoppingMod, weatherMod, dashMod, frameMod, gamesMod, soundsMod, navMod, voiceMod] = await Promise.all(
    [
      import('./backup'),
      import('./todos'),
      import('./localEvents'),
      import('./shopping'),
      import('./weather'),
      import('./dashboard'),
      import('./frame'),
      import('../games/store'),
      import('./sounds'),
      import('../components/ModuleNav'),
      import('../voice/settings'),
    ],
  );
  return { backup, todosMod, localMod, shoppingMod, weatherMod, dashMod, frameMod, gamesMod, soundsMod, navMod, voiceMod };
}

describe('full backup export & import', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exports and restores settings, timetables, and all module data while keeping the voice API key private', async () => {
    const m = await loadModules();

    const cfg = defaultConfig();
    cfg.settings.style = 'aurora';
    cfg.members = [
      {
        id: 'm1',
        name: 'Lena',
        color: '#a855f7',
        avatar: { type: 'emoji', value: '🦄' },
        timetable: {
          schoolType: 'gymnasium',
          periods: DEFAULT_PERIODS.map((p) => ({ ...p })),
          cells: [
            ['de', 'ma', null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
          ],
        },
      },
    ];
    cfg.calendars = [{ id: 'c1', name: 'Familie', url: 'https://example.com/a.ics', memberIds: ['m1'], enabled: true }];
    cfg.school = { colors: { ma: '#ff0000' }, custom: [{ id: 'ag', name: 'Robotik', short: 'Rob', color: '#00aa88' }] };

    m.todosMod.todos.set([{ id: 't1', text: 'Milch kaufen', memberIds: ['m1'], done: false, createdAt: 1000, x: 40, y: 60 }]);
    m.localMod.localEvents.set([
      {
        id: 'le1',
        title: 'Fußballtraining',
        date: '2026-11-10',
        allDay: false,
        startTime: '15:00',
        endTime: '16:30',
        repeat: 'weekly',
        memberIds: ['m1'],
        createdAt: 1000,
      },
    ]);
    m.shoppingMod.shopping.set({
      list: [{ itemId: 'milk', qty: 2, addedAt: 1000 }],
      custom: [{ id: 'custom-1', name: 'Hafermilch', cat: 'dairy', emoji: '🥛', custom: true }],
      hidden: ['butter'],
      bought: { milk: 5 },
    });
    m.weatherMod.weatherSettings.set({
      places: [{ id: 'p1', name: 'Berlin', lat: 52.52, lon: 13.4 }],
      activeId: 'p1',
    });
    m.dashMod.dashboardLayout.set([{ id: 'w1', type: 'todos', size: 'l' }]);
    m.frameMod.frameSettings.set({ ...m.frameMod.frameSettings.get(), intervalSec: 300, clockFace: 'a-minimal', motion: false });
    m.gamesMod.gamesSettingsStore.set({ enabled: true, dailyMinutes: 30, from: 14, to: 19 });
    m.gamesMod.gamesRecordsStore.set({ 'mines:easy': { m1: 42 } });
    m.soundsMod.updateSoundSettings({ volume: 0.75, reminderMinutes: 10, reminderSpeak: true, quietFrom: 22 });
    m.navMod.moduleOrderStore.set(['todos', 'shopping', 'calendar', 'timetable', 'weather', 'frame', 'games', 'apps']);
    m.voiceMod.updateVoiceSettings({ apiKey: 'SECRET-KEY-123', model: 'gemini-3.5-flash', speak: false });

    const raw = JSON.parse(JSON.stringify(m.backup.buildBackup(cfg)));

    // API key must never appear in the exported JSON
    expect(JSON.stringify(raw)).not.toContain('SECRET-KEY-123');
    expect(raw.data.voice).toEqual({ model: 'gemini-3.5-flash', speak: false });

    // Import onto a fresh device that already has its own local Gemini API key
    const target = await loadModules();
    target.voiceMod.updateVoiceSettings({ apiKey: 'LOCAL-DEVICE-KEY' });

    const parsed = target.backup.parseBackup(raw);
    let appliedConfig = defaultConfig();
    target.backup.applyBackup(parsed, (c) => {
      appliedConfig = c;
    });

    expect(appliedConfig.settings.style).toBe('aurora');
    expect(appliedConfig.members[0].timetable?.cells[0][0]).toBe('de');
    expect(appliedConfig.school.custom[0].name).toBe('Robotik');
    expect(target.todosMod.todos.get()).toHaveLength(1);
    expect(target.todosMod.todos.get()[0].text).toBe('Milch kaufen');
    expect(target.localMod.localEvents.get()).toHaveLength(1);
    expect(target.localMod.localEvents.get()[0]).toMatchObject({ title: 'Fußballtraining', repeat: 'weekly', startTime: '15:00' });
    expect(target.shoppingMod.shopping.get().list[0].qty).toBe(2);
    expect(target.shoppingMod.shopping.get().custom[0].name).toBe('Hafermilch');
    expect(target.weatherMod.weatherSettings.get().places[0].name).toBe('Berlin');
    expect(target.dashMod.dashboardLayout.get()).toEqual([{ id: 'w1', type: 'todos', size: 'l' }]);
    expect(target.frameMod.frameSettings.get().intervalSec).toBe(300);
    expect(target.frameMod.frameSettings.get().clockFace).toBe('a-minimal');
    expect(target.gamesMod.gamesSettingsStore.get()).toEqual({ enabled: true, dailyMinutes: 30, from: 14, to: 19 });
    expect(target.gamesMod.gamesRecordsStore.get()).toEqual({ 'mines:easy': { m1: 42 } });
    expect(target.soundsMod.soundSettings.get()).toMatchObject({ volume: 0.75, reminderMinutes: 10, reminderSpeak: true, quietFrom: 22 });
    expect(target.navMod.moduleOrderStore.get().slice(0, 2)).toEqual(['todos', 'shopping']);
    expect(target.voiceMod.getVoiceSettings()).toEqual({
      apiKey: 'LOCAL-DEVICE-KEY',
      model: 'gemini-3.5-flash',
      speak: false,
    });
  });

  it('stays backward-compatible with older config-only backups without data', async () => {
    const m = await loadModules();
    m.todosMod.todos.set([{ id: 'existing', text: 'Bleibt erhalten', memberIds: ['m1'], done: false, createdAt: 1 }]);

    const legacy = { ...defaultConfig(), members: [{ id: 'm1', name: 'Max', color: '#22a06b', avatar: { type: 'initials' } }] };
    const parsed = m.backup.parseBackup(legacy);
    let applied = defaultConfig();
    m.backup.applyBackup(parsed, (c) => {
      applied = c;
    });

    expect(applied.members[0].name).toBe('Max');
    expect(m.todosMod.todos.get()[0].id).toBe('existing');
  });
});
