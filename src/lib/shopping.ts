import { uid } from './id';
import { arrayOf, isRecord, isString, persisted, usePersisted } from './persisted';
import { playSound } from './sounds';
import { t, type Messages } from '../i18n';

const KEY = 'fc.shopping';

export type CategoryId =
  'produce' | 'bakery' | 'dairy' | 'meat' | 'pantry' | 'breakfast' | 'drinks' | 'frozen' | 'care' | 'household' | 'other';

/** Order roughly follows a walk through a German supermarket. */
const CATEGORY_DATA: [CategoryId, string, string][] = [
  ['produce', '🥦', '#4caf50'],
  ['bakery', '🥐', '#c58b45'],
  ['dairy', '🧀', '#e3b72c'],
  ['meat', '🥩', '#d9534f'],
  ['pantry', '🍝', '#d98a3a'],
  ['breakfast', '🍯', '#a0673c'],
  ['drinks', '🥤', '#3b8fd9'],
  ['frozen', '🧊', '#5bb8d6'],
  ['care', '🧴', '#b06ad1'],
  ['household', '🧻', '#7d8a99'],
  ['other', '🛒', '#8a8f98'],
];

/** departments with name and chip label (`short`) in the active language */
export const CATEGORIES: { id: CategoryId; label: string; /** chip label */ short: string; icon: string; color: string }[] =
  CATEGORY_DATA.map(([id, icon, color]) => ({
    id,
    icon,
    color,
    get label() {
      return t(`shopping.categories.${id}.label`);
    },
    get short() {
      return t(`shopping.categories.${id}.short`);
    },
  }));

export interface ShopItem {
  id: string;
  name: string;
  emoji: string;
  cat: CategoryId;
  /** created by the family, not part of the built-in catalogue */
  custom?: boolean;
}

type ItemId = keyof Messages['shopping']['items'];

// [id, emoji] – the name comes from the language files (shopping.items.<id>)
const CATALOG: Record<Exclude<CategoryId, 'other'>, [ItemId, string][]> = {
  produce: [
    ['apples', '🍎'],
    ['bananas', '🍌'],
    ['pears', '🍐'],
    ['grapes', '🍇'],
    ['strawberries', '🍓'],
    ['blueberries', '🫐'],
    ['oranges', '🍊'],
    ['mandarins', '🍊'],
    ['lemons', '🍋'],
    ['kiwis', '🥝'],
    ['melon', '🍉'],
    ['pineapple', '🍍'],
    ['avocado', '🥑'],
    ['tomatoes', '🍅'],
    ['cucumber', '🥒'],
    ['peppers', '🫑'],
    ['lettuce', '🥬'],
    ['potatoes', '🥔'],
    ['sweetpotatoes', '🍠'],
    ['onions', '🧅'],
    ['garlic', '🧄'],
    ['carrots', '🥕'],
    ['kohlrabi', '🥬'],
    ['cauliflower', '🥦'],
    ['broccoli', '🥦'],
    ['zucchini', '🥒'],
    ['mushrooms', '🍄'],
    ['corn', '🌽'],
    ['herbs', '🌿'],
  ],
  bakery: [
    ['bread', '🍞'],
    ['toast', '🍞'],
    ['rolls', '🥖'],
    ['chocrolls', '🥐'],
    ['croissants', '🥐'],
    ['pretzels', '🥨'],
    ['crispbread', '🍘'],
    ['wraps', '🌯'],
  ],
  dairy: [
    ['milk', '🥛'],
    ['lfmilk', '🥛'],
    ['yogurt', '🥣'],
    ['quark', '🥣'],
    ['butter', '🧈'],
    ['saltbutter', '🧈'],
    ['cheeseslices', '🧀'],
    ['gouda', '🧀'],
    ['creamcheese', '🧀'],
    ['mozzarella', '🧀'],
    ['parmesan', '🧀'],
    ['cream', '🥛'],
    ['eggs', '🥚'],
    ['pudding', '🍮'],
  ],
  meat: [
    ['salami', '🍖'],
    ['liverwurst', '🌭'],
    ['teewurst', '🥪'],
    ['ham', '🥓'],
    ['mince', '🥩'],
    ['chicken', '🍗'],
    ['schnitzel', '🥩'],
    ['sausages', '🌭'],
    ['salmon', '🐟'],
  ],
  pantry: [
    ['pasta', '🍝'],
    ['rice', '🍚'],
    ['flour', '🌾'],
    ['sugar', '🍬'],
    ['salt', '🧂'],
    ['pepper', '🌶️'],
    ['oil', '🫒'],
    ['vinegar', '🍶'],
    ['bakingpowder', '🧁'],
    ['tomatosauce', '🥫'],
    ['broth', '🍲'],
    ['ketchup', '🍅'],
    ['mustard', '🌭'],
    ['oats', '🌾'],
    ['lentils', '🫘'],
  ],
  breakfast: [
    ['muesli', '🥣'],
    ['cornflakes', '🥣'],
    ['honey', '🍯'],
    ['jam', '🍓'],
    ['nutella', '🌰'],
    ['cocoa', '🍫'],
    ['corny', '🍫'],
    ['chocolate', '🍫'],
    ['cookies', '🍪'],
    ['gummies', '🐻'],
    ['chips', '🍟'],
    ['popcorn', '🍿'],
    ['espresso', '☕'],
    ['coffee', '☕'],
    ['tea', '🍵'],
  ],
  drinks: [
    ['water', '💧'],
    ['smallwater', '💧'],
    ['applespritzer', '🧃'],
    ['applejuice', '🧃'],
    ['orangejuice', '🧃'],
    ['cola', '🥤'],
    ['sprite', '🥤'],
    ['fanta', '🥤'],
    ['sodastream', '🫧'],
    ['beer', '🍺'],
    ['wine', '🍷'],
  ],
  frozen: [
    ['pizza', '🍕'],
    ['fries', '🍟'],
    ['fishsticks', '🐟'],
    ['frozenveg', '🥦'],
    ['icecream', '🍦'],
  ],
  care: [
    ['toothpaste', '🪥'],
    ['kidstoothpaste', '🪥'],
    ['toothbrushes', '🪥'],
    ['shampoo', '🧴'],
    ['showergel', '🧴'],
    ['conditioner', '🧴'],
    ['soap', '🧼'],
    ['deo', '🧴'],
    ['cottonbuds', '👂'],
    ['cottonpads', '☁️'],
    ['sunscreen', '☀️'],
    ['plasters', '🩹'],
    ['razor', '🪒'],
  ],
  household: [
    ['toiletpaper', '🧻'],
    ['tissues', '🤧'],
    ['kitchenroll', '🧻'],
    ['dishsoap', '🧽'],
    ['dishtabs', '🫧'],
    ['detergent', '🧺'],
    ['softener', '🧺'],
    ['bins', '🗑️'],
    ['foil', '📜'],
    ['bakingpaper', '📜'],
    ['sponges', '🧽'],
    ['cleaner', '🧴'],
    ['batteries', '🔋'],
  ],
};

/** the built-in catalogue; names in the active language (ids stay the same in every language) */
export const BUILTIN: ShopItem[] = Object.entries(CATALOG).flatMap(([cat, items]) =>
  items.map(([id, emoji]) => ({
    id,
    emoji,
    cat: cat as CategoryId,
    get name() {
      return t(`shopping.items.${id}`);
    },
  })),
);

/** Emoji offered when the family adds their own item. */
export const EMOJI_CHOICES = [
  '🛒',
  '🍎',
  '🥕',
  '🥬',
  '🍞',
  '🥛',
  '🧀',
  '🥩',
  '🐟',
  '🍝',
  '🥫',
  '🧂',
  '🍯',
  '🍫',
  '🍪',
  '☕',
  '🥤',
  '🧃',
  '🍺',
  '🧊',
  '🧴',
  '🧼',
  '🪥',
  '🧻',
  '🧽',
  '🧺',
  '🔋',
  '💊',
  '🐶',
  '🐱',
  '🎁',
  '🌷',
];

export interface ListEntry {
  itemId: string;
  qty: number;
  addedAt: number;
  /** put on the list by the demo family */
  demo?: true;
}

export interface ShoppingState {
  list: ListEntry[];
  custom: ShopItem[];
  /** built-in items the family does not need */
  hidden: string[];
  /** how often each item was bought, for the "Häufig" row */
  bought: Record<string, number>;
}

const EMPTY: ShoppingState = { list: [], custom: [], hidden: [], bought: {} };

const isEntry = (e: unknown): e is ListEntry => isRecord(e) && typeof e.itemId === 'string' && typeof e.qty === 'number';
const isItem = (i: unknown): i is ShopItem => isRecord(i) && typeof i.id === 'string' && typeof i.name === 'string';

function parseState(raw: unknown): ShoppingState {
  if (!isRecord(raw)) return EMPTY;
  const bought: Record<string, number> = {};
  if (isRecord(raw.bought)) for (const [k, v] of Object.entries(raw.bought)) if (typeof v === 'number') bought[k] = v;
  return {
    list: arrayOf(raw.list, isEntry),
    custom: arrayOf(raw.custom, isItem),
    hidden: arrayOf(raw.hidden, isString),
    bought,
  };
}

/** the stored list and pantry (demo data and resets use it directly; components use `useShopping`) */
export const shopping = persisted<ShoppingState>(KEY, parseState);

/* actions – module functions, so they are stable for React */

/** tap in the pantry: put on the list, or one more if it is already there */
function add(itemId: string) {
  shopping.set((s) => {
    const has = s.list.some((e) => e.itemId === itemId);
    const list = has
      ? s.list.map((e) => (e.itemId === itemId ? { ...e, qty: Math.min(e.qty + 1, 99) } : e))
      : [...s.list, { itemId, qty: 1, addedAt: Date.now() }];
    return { ...s, list };
  });
  playSound('shopPop');
}

function setQty(itemId: string, qty: number) {
  shopping.set((s) => ({
    ...s,
    list: qty <= 0 ? s.list.filter((e) => e.itemId !== itemId) : s.list.map((e) => (e.itemId === itemId ? { ...e, qty } : e)),
  }));
}

/** bought: off the list, remembered for the "Häufig" row */
function check(itemId: string) {
  let removed = false;
  shopping.set((s) => {
    if (!s.list.some((e) => e.itemId === itemId)) return s;
    removed = true;
    return {
      ...s,
      list: s.list.filter((e) => e.itemId !== itemId),
      bought: { ...s.bought, [itemId]: (s.bought[itemId] ?? 0) + 1 },
    };
  });
  if (removed) playSound('shopPop');
}

/** undo a check */
function restore(entry: ListEntry) {
  shopping.set((s) => {
    if (s.list.some((e) => e.itemId === entry.itemId)) return s;
    const n = (s.bought[entry.itemId] ?? 1) - 1;
    const bought = { ...s.bought };
    if (n > 0) bought[entry.itemId] = n;
    else delete bought[entry.itemId];
    return { ...s, list: [...s.list, entry], bought };
  });
}

function createItem(name: string, emoji: string, cat: CategoryId): ShopItem {
  const item: ShopItem = { id: `c-${uid()}`, name, emoji, cat, custom: true };
  shopping.set((s) => ({ ...s, custom: [...s.custom, item] }));
  return item;
}

/** custom items are deleted, built-in ones only hidden */
function removeItem(item: ShopItem) {
  shopping.set((s) => ({
    ...s,
    list: s.list.filter((e) => e.itemId !== item.id),
    custom: item.custom ? s.custom.filter((c) => c.id !== item.id) : s.custom,
    hidden: item.custom || s.hidden.includes(item.id) ? s.hidden : [...s.hidden, item.id],
  }));
}

function unhideAll() {
  shopping.set((s) => ({ ...s, hidden: [] }));
}

/** The shopping list and pantry (per device; other tabs stay in sync). */
export function useShopping() {
  return { ...usePersisted(shopping), add, setQty, check, restore, createItem, removeItem, unhideAll };
}

/** Case- and umlaut-insensitive compare for the search box. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}
