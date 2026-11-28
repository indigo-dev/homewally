import { CATEGORIES, norm, type CategoryId, type ListEntry, type ShopItem } from '../lib/shopping';
import { newTodo, type Todo } from '../lib/todos';
import { newLocalEvent, type LocalEvent } from '../lib/localEvents';
import type { Member } from '../types';
import { EVERYONE, type CheckTodoRequest, type Command, type DeleteEventRequest } from './command';
import { t, locale } from '../i18n';
import { fmt } from '../lib/dates';

/* Carries out the changing parts of a command (shopping list, to-dos) and returns how to undo them. */

export interface ApplyDeps {
  /** every known item, also hidden ones */
  items: ShopItem[];
  list: ListEntry[];
  setQty: (itemId: string, qty: number) => void;
  add: (itemId: string) => void;
  createItem: (name: string, emoji: string, cat: CategoryId) => ShopItem;
  removeItem: (item: ShopItem) => void;
  /** bought: off the list */
  check: (itemId: string) => void;
  /** undo of check */
  restore: (entry: ListEntry) => void;
  members: Member[];
  todos: Todo[];
  upsertTodo: (t: Todo) => void;
  removeTodo: (id: string) => void;
  localCalendarEnabled?: boolean;
  localEvents?: LocalEvent[];
  upsertLocalEvent?: (e: LocalEvent) => void;
  removeLocalEvent?: (id: string) => void;
}

export interface Line {
  icon: string;
  text: string;
}

export interface Applied {
  lines: Line[];
  /** spoken summary */
  speech: string[];
  undo?: () => void;
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1);
/** 1–10 as a word for speaking ("drei Äpfel", "three apples") */
export const numberWord = (n: number) => t('voice.numbers').split(',')[n - 1] ?? String(n);

/** finds a pantry item by name: exact (ignoring case and umlauts), else the only one that starts with it */
export function findItem(items: ShopItem[], name: string): ShopItem | undefined {
  const n = norm(name);
  if (!n) return undefined;
  const exact = items.find((i) => norm(i.name) === n);
  if (exact) return exact;
  const prefix = items.filter((i) => norm(i.name).startsWith(n) || n.startsWith(norm(i.name)));
  return prefix.length === 1 ? prefix[0] : undefined;
}

/** family members by spoken name (first name is enough) */
export function findMembers(members: Member[], names: string[]): Member[] {
  const out: Member[] = [];
  for (const name of names) {
    const n = norm(name);
    const m = members.find((x) => norm(x.name) === n) ?? members.find((x) => norm(x.name).startsWith(n) || n.startsWith(norm(x.name)));
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/** names as the model gave them → members; EVERYONE = the whole family */
export function whoOf(members: Member[], names: string[]): Member[] {
  return names.includes(EVERYONE) ? members : findMembers(members, names);
}

const WHO_PARTS = ['addTodos', 'addEvents', 'askTodos', 'askTimetable'] as const;

/** true if a request about people names nobody of the family – then the app asks "für wen?" */
export function missingWho(cmd: Command, members: Member[]): boolean {
  return members.length > 0 && WHO_PARTS.some((p) => cmd[p].some((r) => whoOf(members, r.members).length === 0));
}

/** the answer to "für wen?": these names for every request that had nobody */
export function fillWho(cmd: Command, members: Member[], names: string[]): Command {
  const fill = <T extends { members: string[] }>(rs: T[]) =>
    rs.map((r) => (whoOf(members, r.members).length ? r : { ...r, members: names }));
  return {
    ...cmd,
    addTodos: fill(cmd.addTodos),
    addEvents: fill(cmd.addEvents),
    askTodos: fill(cmd.askTodos),
    askTimetable: fill(cmd.askTimetable),
  };
}

const words = (s: string) =>
  s
    .split(/[^\p{L}\p{N}]+/u)
    .map(norm)
    .filter((w) => w.length > 2);

/** the open to-do meant by a spoken text: same text, else the one sharing most words (only if it is the clear best) */
export function findTodo(todos: Todo[], req: CheckTodoRequest, members: Member[]): Todo | undefined {
  const who = whoOf(members, req.members);
  const open = todos.filter((x) => !x.done && (!who.length || x.memberIds.some((id) => who.some((m) => m.id === id))));
  const n = norm(req.text);
  const exact = open.find((x) => norm(x.text) === n);
  if (exact) return exact;
  const want = words(req.text);
  const scored = open
    .map((x) => {
      const have = words(x.text);
      return { x, hits: want.filter((w) => have.some((h) => h.startsWith(w) || w.startsWith(h))).length };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (!scored.length || (scored[1] && scored[1].hits === scored[0].hits)) return undefined;
  return scored[0].x;
}

/** finds the local family calendar event meant by a spoken deletion request */
export function findLocalEvent(events: LocalEvent[], req: DeleteEventRequest, members: Member[]): LocalEvent | undefined {
  const who = whoOf(members, req.members);
  const candidates = events.filter(
    (x) => (!req.date || x.date === req.date) && (!who.length || x.memberIds.some((id) => who.some((m) => m.id === id))),
  );
  const n = norm(req.title);
  const exact = candidates.filter((x) => norm(x.title) === n);
  if (exact.length === 1) return exact[0];
  const want = words(req.title);
  const scored = candidates
    .map((x) => {
      const have = words(x.title);
      return { x, hits: want.filter((w) => have.some((h) => h.startsWith(w) || w.startsWith(h))).length };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (!scored.length || (scored[1] && scored[1].hits === scored[0].hits)) return undefined;
  return scored[0].x;
}

type Changes = Pick<Command, 'addShopping' | 'checkShopping' | 'addTodos' | 'checkTodos'> &
  Partial<Pick<Command, 'addEvents' | 'deleteEvents'>>;

export function applyCommand(cmd: Changes, deps: ApplyDeps): Applied {
  const lines: Line[] = [];
  const speech: string[] = [];
  const undos: (() => void)[] = [];

  /* shopping list */
  const shopped: string[] = [];
  for (const req of cmd.addShopping) {
    let item = findItem(deps.items, req.name);
    let created = false;
    if (!item) {
      const cat = req.category ?? 'other';
      const emoji = CATEGORIES.find((c) => c.id === cat)?.icon ?? '🛒';
      item = deps.createItem(capitalize(req.name), emoji, cat);
      deps.items = [...deps.items, item];
      created = true;
    }
    const prev = deps.list.find((e) => e.itemId === item.id)?.qty ?? 0;
    if (prev === 0) deps.add(item.id);
    const qty = Math.min(prev + req.qty, 99);
    deps.setQty(item.id, qty);
    deps.list =
      prev === 0
        ? [...deps.list, { itemId: item.id, qty, addedAt: Date.now() }]
        : deps.list.map((e) => (e.itemId === item.id ? { ...e, qty } : e));
    const it = item;
    undos.push(created ? () => deps.removeItem(it) : () => deps.setQty(it.id, prev));
    const label = `${req.qty > 1 ? `${req.qty} × ` : ''}${item.name}`;
    lines.push({ icon: item.emoji, text: prev ? t('voice.nowQty', { text: label, n: qty }) : label });
    shopped.push(req.qty > 1 ? `${numberWord(req.qty)} ${item.name}` : item.name);
  }
  if (shopped.length)
    speech.push(t('voice.onList', { items: joinAnd(shopped), n: shopped.length > 1 || cmd.addShopping[0].qty > 1 ? 2 : 1 }));

  /* bought */
  const bought: string[] = [];
  for (const name of cmd.checkShopping) {
    const onList = deps.items.filter((i) => deps.list.some((e) => e.itemId === i.id));
    const item = findItem(onList, name);
    const entry = item && deps.list.find((e) => e.itemId === item.id);
    if (!item || !entry) {
      lines.push({ icon: '🤷', text: t('voice.notOnList', { name: capitalize(name) }) });
      continue;
    }
    deps.check(item.id);
    deps.list = deps.list.filter((e) => e !== entry);
    undos.push(() => deps.restore(entry));
    lines.push({ icon: '✅', text: t('voice.checkedItem', { name: item.name }) });
    bought.push(item.name);
  }
  if (bought.length) speech.push(t('voice.boughtSpeech', { items: joinAnd(bought), n: bought.length }));

  /* to-dos */
  for (const req of cmd.addTodos) {
    if (deps.members.length === 0) {
      lines.push({ icon: '⚠️', text: t('voice.noFamily', { text: req.text }) });
      continue;
    }
    const who = whoOf(deps.members, req.members);
    const todo: Todo = { ...newTodo((who.length ? who : deps.members).map((m) => m.id)), text: req.text, due: req.due };
    deps.upsertTodo(todo);
    undos.push(() => deps.removeTodo(todo.id));
    const due = req.due
      ? t('voice.until', { date: fmt(new Date(`${req.due}T00:00`), { weekday: 'short', day: 'numeric', month: 'numeric' }) })
      : '';
    const forWho = who.length && who.length < deps.members.length ? t('voice.forWhom', { names: joinAnd(who.map((m) => m.name)) }) : '';
    lines.push({ icon: '📌', text: t('voice.todoLine', { text: req.text, who: forWho, due }) });
    speech.push(t('voice.todoNoted', { text: req.text }));
  }

  /* done to-dos */
  for (const req of cmd.checkTodos) {
    const todo = findTodo(deps.todos, req, deps.members);
    if (!todo) {
      lines.push({ icon: '🤷', text: t('voice.todoNotFound', { text: req.text }) });
      continue;
    }
    deps.upsertTodo({ ...todo, done: true, doneAt: Date.now() });
    deps.todos = deps.todos.filter((x) => x.id !== todo.id);
    undos.push(() => deps.upsertTodo(todo));
    lines.push({ icon: '✅', text: t('voice.todoChecked', { text: todo.text }) });
    speech.push(t('voice.todoDone', { text: todo.text }));
  }

  /* local family calendar: add events */
  const localEnabled = deps.localCalendarEnabled !== false;
  let localList = deps.localEvents ?? [];
  for (const req of cmd.addEvents ?? []) {
    if (!localEnabled || !deps.upsertLocalEvent || !deps.removeLocalEvent) {
      lines.push({ icon: '⚠️', text: t('voice.localCalOff') });
      speech.push(t('voice.localCalOff'));
      continue;
    }
    if (deps.members.length === 0) {
      lines.push({ icon: '⚠️', text: t('voice.noFamily', { text: req.title }) });
      continue;
    }
    const who = whoOf(deps.members, req.members);
    const ev: LocalEvent = {
      ...newLocalEvent(
        (who.length ? who : deps.members).map((m) => m.id),
        req.date,
      ),
      title: req.title,
      endDate: req.endDate,
      allDay: req.allDay,
      startTime: req.startTime,
      endTime: req.endTime,
      repeat: req.repeat,
      location: req.location,
    };
    deps.upsertLocalEvent(ev);
    localList = [...localList, ev];
    const remove = deps.removeLocalEvent;
    undos.push(() => remove(ev.id));
    const dayStr = fmt(new Date(`${ev.date}T00:00`), { weekday: 'short', day: 'numeric', month: 'numeric' });
    const timeStr = ev.allDay ? '' : ` ${ev.startTime}`;
    const forWho = who.length && who.length < deps.members.length ? t('voice.forWhom', { names: joinAnd(who.map((m) => m.name)) }) : '';
    lines.push({ icon: '📅', text: t('voice.eventAddedLine', { title: ev.title, when: `${dayStr}${timeStr}`, who: forWho }) });
    speech.push(t('voice.eventAddedSpeech', { title: ev.title }));
  }

  /* local family calendar: delete events */
  for (const req of cmd.deleteEvents ?? []) {
    if (!localEnabled || !deps.upsertLocalEvent || !deps.removeLocalEvent) {
      lines.push({ icon: '⚠️', text: t('voice.localCalOff') });
      speech.push(t('voice.localCalOff'));
      continue;
    }
    const ev = findLocalEvent(localList, req, deps.members);
    if (!ev) {
      lines.push({ icon: '🤷', text: t('voice.eventNotFound', { title: req.title }) });
      speech.push(t('voice.eventNotFound', { title: req.title }));
      continue;
    }
    deps.removeLocalEvent(ev.id);
    localList = localList.filter((x) => x.id !== ev.id);
    const upsert = deps.upsertLocalEvent;
    undos.push(() => upsert(ev));
    lines.push({ icon: '🗑️', text: t('voice.eventDeletedLine', { title: ev.title }) });
    speech.push(t('voice.eventDeletedSpeech', { title: ev.title }));
  }

  return {
    lines,
    speech,
    undo: undos.length ? () => undos.reverse().forEach((u) => u()) : undefined,
  };
}

export function joinAnd(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${t('voice.and')} ${xs[xs.length - 1]}`;
}
