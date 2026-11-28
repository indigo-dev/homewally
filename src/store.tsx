import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AppConfig, CalendarSource, Member, SchoolConfig, Settings } from './types';
import { configStore } from './lib/config';
import { pruneLocalEventsMember } from './lib/localEvents';
import { colorScheme, painter, stylePalette, type Paint } from './lib/colors';
import { arrayOf, isString, persisted, usePersisted } from './lib/persisted';
import { resolveLanguage, setLanguage, t } from './i18n';

/* ---------------------------------------------------------------- language */

// The active language follows the setting (and the device language for 'auto'). It is switched in the
// store listener – before React re-renders – so every text of the next render is in the new language.
const syncLanguage = () => {
  setLanguage(resolveLanguage(configStore.get().settings.language));
  if (typeof document !== 'undefined') document.title = t('app.title');
};
syncLanguage();
configStore.subscribe(syncLanguage);
if (typeof window !== 'undefined') window.addEventListener('languagechange', syncLanguage);

/** person filter: empty = all members, otherwise only these members (per device) */
const selectedStore = persisted('fc.selectedMembers', (raw) => arrayOf(raw, isString));

/* ---------------------------------------------------------------- actions (stable module functions) */

const update = (fn: (c: AppConfig) => AppConfig) => configStore.set(fn);

const actions = {
  updateSettings(patch: Partial<Settings>) {
    update((c) => ({ ...c, settings: { ...c.settings, ...patch } }));
  },
  upsertMember(m: Member) {
    update((c) => {
      const idx = c.members.findIndex((x) => x.id === m.id);
      const members = [...c.members];
      if (idx >= 0) members[idx] = m;
      else members.push(m);
      return { ...c, members };
    });
  },
  patchMember(id: string, patch: Partial<Member>) {
    update((c) => ({ ...c, members: c.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  },
  /** removes the person; subscribed calendars drop the assignment, local events prune the member */
  removeMember(id: string) {
    update((c) => ({
      ...c,
      members: c.members.filter((m) => m.id !== id),
      calendars: c.calendars.map((cal) => ({ ...cal, memberIds: cal.memberIds.filter((x) => x !== id) })),
    }));
    pruneLocalEventsMember(id);
  },
  moveMember(id: string, dir: -1 | 1) {
    update((c) => {
      const i = c.members.findIndex((m) => m.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= c.members.length) return c;
      const members = [...c.members];
      [members[i], members[j]] = [members[j], members[i]];
      return { ...c, members };
    });
  },
  /** change a member based on its current state (safe for many quick updates in a row) */
  updateMember(id: string, fn: (m: Member) => Partial<Member>) {
    update((c) => ({ ...c, members: c.members.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)) }));
  },
  upsertCalendar(cal: CalendarSource) {
    update((c) => {
      const exists = c.calendars.some((x) => x.id === cal.id);
      return { ...c, calendars: exists ? c.calendars.map((x) => (x.id === cal.id ? cal : x)) : [...c.calendars, cal] };
    });
  },
  patchCalendar(id: string, patch: Partial<CalendarSource>) {
    update((c) => ({ ...c, calendars: c.calendars.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  },
  removeCalendar(id: string) {
    update((c) => ({ ...c, calendars: c.calendars.filter((x) => x.id !== id) }));
  },
  toggleCalendarMember(calendarId: string, memberId: string) {
    update((c) => ({
      ...c,
      calendars: c.calendars.map((x) =>
        x.id !== calendarId
          ? x
          : {
              ...x,
              memberIds: x.memberIds.includes(memberId) ? x.memberIds.filter((id) => id !== memberId) : [...x.memberIds, memberId],
            },
      ),
    }));
  },
  /** family-wide subject colours and own subjects */
  updateSchool(patch: Partial<SchoolConfig>) {
    update((c) => ({ ...c, school: { ...c.school, ...patch } }));
  },
  /** import of a backup */
  replaceConfig(cfg: AppConfig) {
    configStore.set(cfg);
    selectedStore.set([]);
  },
  /** tap: show only this member (tapping the only selected member again goes back to all) */
  selectOnly(id: string) {
    selectedStore.set((cur) => (cur.length === 1 && cur[0] === id ? [] : [id]));
  },
  /** long press: add/remove this member to/from the selection */
  toggleSelected(id: string) {
    selectedStore.set((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  },
  showAll() {
    selectedStore.set([]);
  },
  /** show exactly these members (voice control: "Stundenplan von Jan") */
  selectMembers(ids: string[]) {
    selectedStore.set(ids);
  },
};

/* ---------------------------------------------------------------- store */

interface Store extends Readonly<typeof actions> {
  config: AppConfig;
  /** people with their colour in the palette of the style (`config.members` keeps the stored colours) */
  members: Member[];
  calendars: CalendarSource[];
  settings: Settings;
  memberById: Map<string, Member>;
  /** maps stored colours (people, subjects, departments) to the palette of the style */
  paint: Paint;
  school: SchoolConfig;
  /** person filter: empty = all members, otherwise only these members */
  selectedIds: Set<string>;
}

const Ctx = createContext<Store | null>(null);

/**
 * Makes the configuration available to the app. The data itself lives in persisted stores
 * (saved on every change, synced with other tabs); the provider adds the derived values once.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const config = usePersisted(configStore);
  const selected = usePersisted(selectedStore);

  const paint = useMemo(() => painter(colorScheme(stylePalette(config.settings.style))), [config.settings.style]);
  const members = useMemo(() => config.members.map((m) => ({ ...m, color: paint(m.color) })), [config.members, paint]);
  // only existing members count; everyone selected is the same as "Alle"
  const selectedIds = useMemo(() => {
    const ids = new Set(selected.filter((id) => config.members.some((m) => m.id === id)));
    return ids.size === config.members.length ? new Set<string>() : ids;
  }, [selected, config.members]);

  const value = useMemo<Store>(
    () => ({
      ...actions,
      config,
      members,
      calendars: config.calendars,
      settings: config.settings,
      memberById: new Map(members.map((m) => [m.id, m])),
      paint,
      school: config.school,
      selectedIds,
    }),
    [config, members, paint, selectedIds],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
