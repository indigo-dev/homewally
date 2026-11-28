import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, EVERYONE, isEmpty, isQuiet, parseCommand, type Command } from './command';
import { applyCommand, fillWho, findItem, findMembers, findTodo, joinAnd, missingWho, whoOf, type ApplyDeps } from './apply';
import { encodeWav } from './recorder';
import { thinkingConfig, understand } from './gemini';
import { onCalendarRequest, requestCalendar } from '../lib/calendarNav';
import { BUILTIN, type ListEntry, type ShopItem } from '../lib/shopping';
import type { Todo } from '../lib/todos';
import type { Member } from '../types';

const member = (id: string, name: string): Member => ({ id, name, color: '#000', avatar: { type: 'initials' } });
const todo = (id: string, text: string, memberIds: string[], done = false): Todo => ({ id, text, memberIds, done, createdAt: 0 });
const cmd = (patch: Partial<Command>): Command => ({ ...parseCommand({ transcript: 'x' }), ...patch });

describe('parseCommand', () => {
  it('keeps valid parts and drops broken ones', () => {
    const c = parseCommand({
      transcript: ' Pack drei Äpfel drauf ',
      addShopping: [{ name: 'Äpfel', qty: 3 }, { name: '', qty: 1 }, { name: 'Milch' }, { name: 'X', qty: 500, category: 'nope' }],
      checkShopping: ['Eier', '', 3],
      addTodos: [
        { text: 'Altpapier', members: ['Anna', 7], due: '2026-11-27' },
        { text: 'Müll', due: 'morgen' },
      ],
      checkTodos: [{ text: 'Müll' }, { text: '' }],
      askWeather: [{ date: '2026-11-23' }, { date: 'tomorrow' }],
      askEvents: [{ from: '2026-11-29', to: '2026-11-23' }],
      askShopping: true,
      askTodos: [{ members: ['Jan'] }, {}],
      askTimetable: [{ date: '2026-11-25', members: ['Jan'] }, { date: 'x' }],
      show: { module: 'none' },
    });
    expect(c.transcript).toBe('Pack drei Äpfel drauf');
    expect(c.addShopping).toEqual([
      { name: 'Äpfel', qty: 3, category: undefined },
      { name: 'Milch', qty: 1, category: undefined },
      { name: 'X', qty: 99, category: undefined },
    ]);
    expect(c.checkShopping).toEqual(['Eier']);
    expect(c.addTodos).toEqual([
      { text: 'Altpapier', members: ['Anna'], due: '2026-11-27' },
      { text: 'Müll', members: [], due: undefined },
    ]);
    expect(c.checkTodos).toEqual([{ text: 'Müll', members: [] }]);
    expect(c.askWeather).toHaveLength(1);
    expect(c.askEvents[0]).toMatchObject({ from: '2026-11-23', to: '2026-11-29' });
    expect(c.askShopping).toBe(true);
    expect(c.askTodos).toEqual([{ members: ['Jan'] }, { members: [] }]);
    expect(c.askTimetable).toEqual([{ date: '2026-11-25', members: ['Jan'] }]);
    expect(c.show).toBeUndefined();
  });

  it('survives garbage', () => {
    const c = parseCommand('nonsense');
    expect(c.transcript).toBe('');
    expect(isEmpty(c)).toBe(true);
    expect(parseCommand({ askShopping: 'yes' }).askShopping).toBe(false);
  });

  it('keeps calendar view and date only for the calendar', () => {
    expect(parseCommand({ show: { module: 'calendar', view: 'week', date: '2026-12-01', members: ['Jan', ''] } }).show).toEqual({
      module: 'calendar',
      members: ['Jan'],
      view: 'week',
      date: '2026-12-01',
    });
    expect(parseCommand({ show: { module: 'calendar', view: 'decade', date: 'soon' } }).show).toEqual({
      module: 'calendar',
      members: [],
      view: undefined,
      date: undefined,
    });
    expect(parseCommand({ show: { module: 'timetable', view: 'week', members: ['Jan'] } }).show).toEqual({
      module: 'timetable',
      members: ['Jan'],
      view: undefined,
      date: undefined,
    });
  });

  it('knows when a command only switches the screen', () => {
    const show = { module: 'shopping' as const, members: [] };
    expect(isQuiet(cmd({ show }))).toBe(true);
    expect(isQuiet(cmd({ show, askShopping: true }))).toBe(false);
    expect(isQuiet(cmd({ askShopping: true }))).toBe(false);
  });
});

describe('buildPrompt', () => {
  it('names today, the family, the pantry and the open to-dos', () => {
    const p = buildPrompt({
      now: new Date(2026, 10, 22, 9, 5),
      members: ['Anna'],
      places: [],
      pantry: ['Milch', 'Äpfel'],
      todos: ['Müll rausbringen'],
    });
    expect(p).toContain('2026-11-22, 09:05');
    expect(p).toContain('Familienmitglieder: Anna.');
    expect(p).toContain('Wetter-Orte (der erste ist Zuhause): keine.');
    expect(p).toContain('Milch, Äpfel');
    expect(p).toContain('Offene To-dos: "Müll rausbringen".');
    expect(p).toContain('ZEIGEN');
  });
});

describe('matching', () => {
  it('finds pantry items ignoring case, umlauts and singular', () => {
    expect(findItem(BUILTIN, 'Apfel')?.id).toBe('apples');
    expect(findItem(BUILTIN, 'milch')?.id).toBe('milk');
    expect(findItem(BUILTIN, 'Drachenfrucht')).toBeUndefined();
  });
  it('finds family members by first name', () => {
    const ms = [member('a', 'Anna Lenz'), member('b', 'Ben')];
    expect(findMembers(ms, ['anna', 'Ben', 'Carla']).map((m) => m.id)).toEqual(['a', 'b']);
    expect(whoOf(ms, [EVERYONE]).map((m) => m.id)).toEqual(['a', 'b']);
  });
  it('joins with "und"', () => {
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b und c');
    expect(joinAnd(['a'])).toBe('a');
  });
  it('finds the to-do that was meant', () => {
    const ms = [member('a', 'Anna'), member('b', 'Ben')];
    const list = [
      todo('1', 'Müll rausbringen', ['a']),
      todo('2', 'Altpapier rausbringen', ['b']),
      todo('3', 'Zahnarzt anrufen', ['a', 'b']),
      todo('4', 'Müll trennen', ['a'], true),
    ];
    expect(findTodo(list, { text: 'zahnarzt anrufen', members: [] }, ms)?.id).toBe('3');
    expect(findTodo(list, { text: 'den Müll', members: [] }, ms)?.id).toBe('1');
    // "rausbringen" fits two – unclear, unless a name decides
    expect(findTodo(list, { text: 'rausbringen', members: [] }, ms)).toBeUndefined();
    expect(findTodo(list, { text: 'rausbringen', members: ['Ben'] }, ms)?.id).toBe('2');
    expect(findTodo(list, { text: 'Fenster putzen', members: [] }, ms)).toBeUndefined();
  });
});

describe('für wen?', () => {
  const ms = [member('a', 'Anna'), member('b', 'Ben')];

  it('asks when a request about people names nobody of the family', () => {
    expect(missingWho(cmd({ askTodos: [{ members: [] }] }), ms)).toBe(true);
    expect(missingWho(cmd({ askTodos: [{ members: ['Oma'] }] }), ms)).toBe(true);
    expect(missingWho(cmd({ addTodos: [{ text: 'X', members: [] }] }), ms)).toBe(true);
    expect(missingWho(cmd({ askTimetable: [{ date: '2026-11-25', members: [] }] }), ms)).toBe(true);
    expect(missingWho(cmd({ askTodos: [{ members: ['anna'] }] }), ms)).toBe(false);
    expect(missingWho(cmd({ addTodos: [{ text: 'X', members: [EVERYONE] }] }), ms)).toBe(false);
    // events without a name mean the whole family
    expect(missingWho(cmd({ askEvents: [{ from: '2026-11-25', to: '2026-11-25', members: [] }] }), ms)).toBe(false);
    // without a family there is nobody to ask for
    expect(missingWho(cmd({ askTodos: [{ members: [] }] }), [])).toBe(false);
  });

  it('fills the answer into every request that had nobody', () => {
    const c = fillWho(
      cmd({
        addTodos: [
          { text: 'X', members: [] },
          { text: 'Y', members: ['Ben'] },
        ],
        askTodos: [{ members: [] }],
      }),
      ms,
      ['Anna'],
    );
    expect(c.addTodos.map((r) => r.members)).toEqual([['Anna'], ['Ben']]);
    expect(c.askTodos[0].members).toEqual(['Anna']);
    expect(missingWho(c, ms)).toBe(false);
  });
});

function fakeDeps(list: ListEntry[] = [], members: Member[] = [member('a', 'Anna'), member('b', 'Ben')], todos: Todo[] = []) {
  const state = { list: [...list], custom: [] as ShopItem[], todos: [...todos], bought: [] as string[] };
  const deps: ApplyDeps = {
    items: [...BUILTIN],
    list: [...list],
    add: (id) => state.list.push({ itemId: id, qty: 1, addedAt: 0 }),
    setQty: (id, qty) => {
      state.list = qty <= 0 ? state.list.filter((e) => e.itemId !== id) : state.list.map((e) => (e.itemId === id ? { ...e, qty } : e));
    },
    createItem: (name, emoji, cat) => {
      const item = { id: `c-${name}`, name, emoji, cat, custom: true };
      state.custom.push(item);
      return item;
    },
    removeItem: vi.fn((item: ShopItem) => {
      state.custom = state.custom.filter((c) => c.id !== item.id);
      state.list = state.list.filter((e) => e.itemId !== item.id);
    }),
    check: (id) => {
      state.list = state.list.filter((e) => e.itemId !== id);
      state.bought.push(id);
    },
    restore: (entry) => {
      state.list.push(entry);
      state.bought = state.bought.filter((id) => id !== entry.itemId);
    },
    members,
    todos: [...todos],
    upsertTodo: (t) => {
      state.todos = state.todos.some((x) => x.id === t.id) ? state.todos.map((x) => (x.id === t.id ? t : x)) : [...state.todos, t];
    },
    removeTodo: (id) => (state.todos = state.todos.filter((t) => t.id !== id)),
  };
  return { deps, state };
}

const changes = (patch: Partial<Command>) => ({ addShopping: [], checkShopping: [], addTodos: [], checkTodos: [], ...patch });

describe('applyCommand', () => {
  it('adds items with quantities, creates unknown ones and undoes everything', () => {
    const { deps, state } = fakeDeps([{ itemId: 'milk', qty: 1, addedAt: 0 }]);
    const res = applyCommand(
      changes({
        addShopping: [
          { name: 'Äpfel', qty: 3 },
          { name: 'Milch', qty: 1 },
          { name: 'grillkohle', qty: 1, category: 'household' },
        ],
      }),
      deps,
    );
    expect(state.list).toEqual([
      { itemId: 'milk', qty: 2, addedAt: 0 },
      { itemId: 'apples', qty: 3, addedAt: 0 },
      { itemId: 'c-Grillkohle', qty: 1, addedAt: 0 },
    ]);
    expect(state.custom[0]).toMatchObject({ name: 'Grillkohle', emoji: '🧻', cat: 'household' });
    expect(res.lines.map((l) => l.text)).toEqual(['3 × Äpfel', 'Milch (jetzt 2)', 'Grillkohle']);
    expect(res.speech[0]).toBe('drei Äpfel, Milch und Grillkohle stehen auf der Einkaufsliste.');

    res.undo!();
    expect(state.list).toEqual([{ itemId: 'milk', qty: 1, addedAt: 0 }]);
    expect(state.custom).toEqual([]);
  });

  it('adds the same item twice in one request', () => {
    const { deps, state } = fakeDeps();
    applyCommand(
      changes({
        addShopping: [
          { name: 'Milch', qty: 1 },
          { name: 'Milch', qty: 2 },
        ],
      }),
      deps,
    );
    expect(state.list).toEqual([{ itemId: 'milk', qty: 3, addedAt: 0 }]);
  });

  it('ticks off bought items that are on the list and undoes it', () => {
    const milk = { itemId: 'milk', qty: 2, addedAt: 5 };
    const { deps, state } = fakeDeps([milk]);
    const res = applyCommand(changes({ checkShopping: ['milch', 'Eier'] }), deps);
    expect(state.list).toEqual([]);
    expect(state.bought).toEqual(['milk']);
    expect(res.lines.map((l) => l.text)).toEqual(['Milch abgehakt', 'Eier steht nicht auf der Einkaufsliste']);
    expect(res.speech).toEqual(['Milch ist abgehakt.']);
    res.undo!();
    expect(state.list).toEqual([milk]);
  });

  it('creates to-dos for the named members or the whole family', () => {
    const { deps, state } = fakeDeps();
    const res = applyCommand(
      changes({
        addTodos: [
          { text: 'Turnsachen einpacken', members: ['anna'], due: '2026-11-23' },
          { text: 'Altpapier', members: [EVERYONE] },
        ],
      }),
      deps,
    );
    expect(state.todos.map((t) => [t.text, t.memberIds, t.due])).toEqual([
      ['Turnsachen einpacken', ['a'], '2026-11-23'],
      ['Altpapier', ['a', 'b'], undefined],
    ]);
    expect(res.lines[0].text).toMatch(/^„Turnsachen einpacken“ für Anna · bis /);
    expect(res.lines[1].text).toBe('„Altpapier“');
    res.undo!();
    expect(state.todos).toEqual([]);
  });

  it('checks off a to-do and undoes it', () => {
    const open = todo('1', 'Müll rausbringen', ['a']);
    const { deps, state } = fakeDeps([], undefined, [open]);
    const res = applyCommand(changes({ checkTodos: [{ text: 'Müll', members: [] }] }), deps);
    expect(state.todos[0]).toMatchObject({ id: '1', done: true });
    expect(res.speech).toEqual(['„Müll rausbringen“ ist erledigt.']);
    res.undo!();
    expect(state.todos).toEqual([open]);
  });

  it('does not create to-dos without a family', () => {
    const { deps, state } = fakeDeps([], []);
    const res = applyCommand(changes({ addTodos: [{ text: 'X', members: [] }] }), deps);
    expect(state.todos).toEqual([]);
    expect(res.undo).toBeUndefined();
    expect(res.lines[0].icon).toBe('⚠️');
  });

  it('adds and deletes local family calendar events with undo', () => {
    const { deps } = fakeDeps();
    const localState: { id: string; title: string; date: string; memberIds: string[]; repeat: string }[] = [];
    const localDeps = {
      ...deps,
      localCalendarEnabled: true,
      get localEvents() {
        return localState as never;
      },
      upsertLocalEvent: (ev: { id: string; title: string; date: string; memberIds: string[]; repeat: string }) => {
        const i = localState.findIndex((x) => x.id === ev.id);
        if (i >= 0) localState[i] = ev;
        else localState.push(ev);
      },
      removeLocalEvent: (id: string) => {
        const i = localState.findIndex((x) => x.id === id);
        if (i >= 0) localState.splice(i, 1);
      },
    };

    const parsed = parseCommand({
      transcript: 'Trag Dienstag 15 Uhr Fußball für Anna ein',
      addEvents: [{ title: 'Fußball', date: '2026-12-01', allDay: false, startTime: '15:00', repeat: 'weekly', members: ['Anna'] }],
    });
    expect(parsed.addEvents).toHaveLength(1);
    expect(missingWho(parsed, deps.members)).toBe(false);

    const added = applyCommand(parsed, localDeps);
    expect(localState).toHaveLength(1);
    expect(localState[0]).toMatchObject({ title: 'Fußball', date: '2026-12-01', memberIds: ['a'], repeat: 'weekly' });

    // delete via voice, then undo
    const deleted = applyCommand(
      parseCommand({ transcript: 'Lösch Fußball', deleteEvents: [{ title: 'Fußball', members: [] }] }),
      localDeps,
    );
    expect(localState).toHaveLength(0);
    deleted.undo!();
    expect(localState).toHaveLength(1);

    // undo the creation
    added.undo!();
    expect(localState).toHaveLength(0);
  });

  it('asks "für wen?" when addEvents names nobody and warns when local calendar is disabled', () => {
    const { deps } = fakeDeps();
    const cmd = parseCommand({
      transcript: 'Trag morgen Zahnarzt ein',
      addEvents: [{ title: 'Zahnarzt', date: '2026-12-01', allDay: true, members: [] }],
    });
    expect(missingWho(cmd, deps.members)).toBe(true);
    const filled = fillWho(cmd, deps.members, ['Anna']);
    expect(missingWho(filled, deps.members)).toBe(false);

    const res = applyCommand(filled, { ...deps, localCalendarEnabled: false });
    expect(res.lines[0].icon).toBe('⚠️');
    expect(res.undo).toBeUndefined();
  });

  it('adds and deletes unassigned birthdays via voice without asking "für wen?"', () => {
    const { deps } = fakeDeps();
    const bdayState: { id: string; name: string; month: number; day: number; year?: number }[] = [];
    const bdayDeps = {
      ...deps,
      birthdaysCalendarEnabled: true,
      get birthdays() {
        return bdayState as never;
      },
      upsertBirthday: (b: { id: string; name: string; month: number; day: number; year?: number }) => {
        const i = bdayState.findIndex((x) => x.id === b.id);
        if (i >= 0) bdayState[i] = b;
        else bdayState.push(b);
      },
      removeBirthday: (id: string) => {
        const i = bdayState.findIndex((x) => x.id === id);
        if (i >= 0) bdayState.splice(i, 1);
      },
    };

    const parsed = parseCommand({
      transcript: 'Trag Omas Geburtstag am 14. Mai 1956 ein',
      addBirthdays: [{ name: 'Oma', day: 14, month: 5, year: 1956 }],
    });
    expect(parsed.addBirthdays).toHaveLength(1);
    // birthdays are never assigned to a family member → must never trigger "Für wen?"
    expect(missingWho(parsed, deps.members)).toBe(false);

    const added = applyCommand(parsed, bdayDeps);
    expect(bdayState).toHaveLength(1);
    expect(bdayState[0]).toMatchObject({ name: 'Oma', day: 14, month: 5, year: 1956 });
    expect(added.lines[0].icon).toBe('🎂');

    const deleted = applyCommand(
      parseCommand({ transcript: 'Lösch den Geburtstag von Oma', deleteBirthdays: [{ name: 'Oma' }] }),
      bdayDeps,
    );
    expect(bdayState).toHaveLength(0);
    deleted.undo!();
    expect(bdayState).toHaveLength(1);

    added.undo!();
    expect(bdayState).toHaveLength(0);
  });
});

describe('calendar requests', () => {
  it('waits until the calendar listens, then arrives once', () => {
    const got: unknown[] = [];
    requestCalendar({ view: 'year' });
    const off = onCalendarRequest((r) => got.push(r));
    requestCalendar({ view: 'week', date: new Date(2026, 11, 1) });
    requestCalendar({});
    off();
    requestCalendar({ view: 'day' });
    expect(got).toEqual([{ view: 'year' }, { view: 'week', date: new Date(2026, 11, 1) }]);
    // the last one waits for the next calendar
    const later: unknown[] = [];
    onCalendarRequest((r) => later.push(r))();
    expect(later).toEqual([{ view: 'day' }]);
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono header', async () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
    const v = new DataView(await wav.arrayBuffer());
    expect(wav.size).toBe(44 + 6);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getInt16(46, true)).toBe(0x7fff);
    expect(v.getInt16(48, true)).toBe(-0x7fff);
  });
});

describe('thinkingConfig', () => {
  it('turns thinking as far down as each model allows', () => {
    expect(thinkingConfig('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfig('gemini-3.5-flash-lite')).toEqual({ thinkingLevel: 'minimal' });
    expect(thinkingConfig('gemini-3.6-flash')).toEqual({ thinkingLevel: 'minimal' });
    expect(thinkingConfig('gemini-3.8-flash')).toEqual({ thinkingLevel: 'low' });
    expect(thinkingConfig('gemini-4-hydrogen')).toEqual({ thinkingLevel: 'low' });
  });
});

describe('understand', () => {
  const ctx = { now: new Date(2026, 10, 22), members: [], places: [], pantry: [] };
  const ok = (body: unknown) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }), { status: 200 });

  it('falls back to the default model when the chosen one is gone', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return url.includes('gemini-2.5-flash:')
        ? new Response('{}', { status: 404 })
        : ok({ transcript: 'Milch', addShopping: [{ name: 'Milch', qty: 1 }] });
    });
    const res = await understand({ kind: 'text', text: 'Milch' }, ctx, {
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      fallbackModel: 'gemini-3.5-flash-lite',
    });
    expect(res.model).toBe('gemini-3.5-flash-lite');
    expect(res.cmd.addShopping).toHaveLength(1);
    expect(urls).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it('sends a follow-up together with the first request', async () => {
    let body: { contents: { parts: unknown[] }[] } | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return ok({ transcript: 'Welche Aufgaben? Jan', askTodos: [{ members: ['Jan'] }] });
    });
    const res = await understand(
      [
        { kind: 'audio', mime: 'audio/wav', base64: 'AAA' },
        { kind: 'text', text: 'Für wen?' },
        { kind: 'audio', mime: 'audio/wav', base64: 'BBB' },
      ],
      ctx,
      { apiKey: 'k', model: 'gemini-3.5-flash-lite' },
    );
    expect(body!.contents[0].parts).toEqual([
      { inlineData: { mimeType: 'audio/wav', data: 'AAA' } },
      { text: 'Für wen?' },
      { inlineData: { mimeType: 'audio/wav', data: 'BBB' } },
    ]);
    expect(res.cmd.askTodos).toEqual([{ members: ['Jan'] }]);
    vi.unstubAllGlobals();
  });

  it('reports a missing model without fallback', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
    await expect(understand({ kind: 'text', text: 'x' }, ctx, { apiKey: 'k', model: 'gemini-9' })).rejects.toThrow(/Modell/);
    vi.unstubAllGlobals();
  });
});
