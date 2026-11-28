import { uid } from './id';
import { arrayOf, isRecord, persisted, usePersisted } from './persisted';
import { playSound } from './sounds';

const KEY = 'fc.todos';

export interface Todo {
  id: string;
  text: string;
  /** at least one family member */
  memberIds: string[];
  /** optional due day as YYYY-MM-DD */
  due?: string;
  done: boolean;
  /** epoch ms */
  createdAt: number;
  doneAt?: number;
  /** position on the board in px (per device, like everything in localStorage); unset = auto place */
  x?: number;
  y?: number;
  /** note scale, 1 = normal */
  size?: number;
  /** stacking order, higher = on top */
  z?: number;
}

const isTodo = (t: unknown): t is Todo =>
  isRecord(t) && typeof t.id === 'string' && typeof t.text === 'string' && Array.isArray(t.memberIds);

/** the stored to-dos (demo data and resets use it directly; components use `useTodos`) */
export const todos = persisted<Todo[]>(KEY, (raw) => arrayOf(raw, isTodo));

export function newTodo(memberIds: string[]): Todo {
  return { id: uid(), text: '', memberIds, done: false, createdAt: Date.now() };
}

/* actions – module functions, so they are stable for React */

function upsert(t: Todo) {
  todos.set((cur) => (cur.some((x) => x.id === t.id) ? cur.map((x) => (x.id === t.id ? t : x)) : [...cur, t]));
}
function remove(id: string) {
  todos.set((cur) => cur.filter((x) => x.id !== id));
}
function toggleDone(id: string) {
  let becameDone = false;
  todos.set((cur) =>
    cur.map((x) => {
      if (x.id !== id) return x;
      if (!x.done) becameDone = true;
      return { ...x, done: !x.done, doneAt: x.done ? undefined : Date.now() };
    }),
  );
  if (becameDone) playSound('todoDone');
}
function patchMany(patches: Record<string, Partial<Todo>>) {
  todos.set((cur) => cur.map((x) => (patches[x.id] ? { ...x, ...patches[x.id] } : x)));
}
function clearDone() {
  todos.set((cur) => cur.filter((x) => !x.done));
}

/** The family's to-dos (per device; other tabs stay in sync). */
export function useTodos() {
  return { todos: usePersisted(todos), upsert, remove, toggleDone, clearDone, patchMany };
}

/** YYYY-MM-DD of a local date */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
