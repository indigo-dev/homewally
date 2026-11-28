import { useSyncExternalStore } from 'react';

/**
 * localStorage access that never throws: private mode, a full quota or blocked storage
 * must not break the app – it keeps working in memory.
 */
export const storage = {
  /** parsed JSON value, `undefined` if missing or unreadable */
  read(key: string): unknown {
    try {
      const s = localStorage.getItem(key);
      return s === null ? undefined : JSON.parse(s);
    } catch {
      return undefined;
    }
  },
  /** false if the value could not be stored */
  write(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  keys(): string[] {
    try {
      // via key(i): works for the real Storage and the in-memory one of the tests
      return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k !== null);
    } catch {
      return [];
    }
  },
};

/** A value kept in localStorage that components can subscribe to. */
export interface Persisted<T> {
  get(): T;
  set(next: T | ((current: T) => T)): void;
  /** validates and replaces the stored value from raw data (e.g. backup import) */
  restore(raw: unknown): void;
  subscribe(listener: () => void): () => void;
  /** reads the stored value again (another tab changed it) */
  reload(): void;
}

/** reload functions by key, for changes made in other tabs */
const registry = new Map<string, () => void>();
let listening = false;

function listenToOtherTabs() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('storage', (e) => {
    // key null = the whole storage was cleared
    if (e.key === null) registry.forEach((reload) => reload());
    else registry.get(e.key)?.();
  });
}

/**
 * Creates a persisted value. `parse` turns whatever is stored (`undefined` if nothing) into a valid
 * value – it validates old or hand-edited data and supplies the defaults. The value is read lazily
 * on first use and written on every `set`. Changes in other tabs are picked up unless `syncTabs` is false
 * (for view state like the open module, which each tab keeps for itself).
 */
export function persisted<T>(key: string, parse: (raw: unknown) => T, { syncTabs = true } = {}): Persisted<T> {
  let value: T;
  let loaded = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const load = (): T => {
    try {
      return parse(storage.read(key));
    } catch (e) {
      console.warn(`Stored data "${key}" is invalid and will be replaced.`, e);
      return parse(undefined);
    }
  };

  const store: Persisted<T> = {
    get() {
      if (!loaded) {
        value = load();
        loaded = true;
      }
      return value;
    },
    set(next) {
      const current = store.get();
      const v = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
      if (Object.is(v, current)) return;
      value = v;
      storage.write(key, v);
      emit();
    },
    restore(raw) {
      let next: T;
      try {
        next = parse(raw);
      } catch {
        next = parse(undefined);
      }
      value = next;
      loaded = true;
      storage.write(key, next);
      emit();
    },
    subscribe(listener) {
      listenToOtherTabs();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reload() {
      value = load();
      loaded = true;
      emit();
    },
  };
  if (syncTabs) registry.set(key, store.reload);
  return store;
}

/** Subscribes a component to a persisted value. */
export function usePersisted<T>(store: Persisted<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/* ------------------------------------------------------------------ small parsers for `persisted` */

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** array of the items that pass `ok` (anything else = empty array) */
export function arrayOf<T>(v: unknown, ok: (x: unknown) => x is T): T[] {
  return Array.isArray(v) ? v.filter(ok) : [];
}

export const isString = (x: unknown): x is string => typeof x === 'string';

/** one of the allowed values, else the fallback */
export function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** finite number in [min, max], else the fallback */
export function numberIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}
