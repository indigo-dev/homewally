import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { softly, vtItem } from '../lib/transition';
import { BUILTIN, CATEGORIES, EMOJI_CHOICES, norm, useShopping, type CategoryId, type ListEntry, type ShopItem } from '../lib/shopping';
import { useTapOrLongPress } from '../lib/hooks';
import { Sym } from '../components/Sym';
import { Modal } from '../components/Modal';
import type { Paint } from '../lib/colors';
import { useStore } from '../store';
import { arrayOf, persisted, usePersisted } from '../lib/persisted';
import './shopping.css';
import { t, locale } from '../i18n';

type Pane = 'list' | 'pantry';

/** how long the "abgehakt" animation runs before the item leaves the list */
const CHECK_MS = 450;
const UNDO_MS = 5000;
const FREQUENT_MAX = 12;

const CATS_KEY = 'fc.shopping.cats';

/** department filter of the pantry, per device */
const catsStore = persisted<CategoryId[]>(CATS_KEY, (raw) => arrayOf(raw, (id): id is CategoryId => CATEGORIES.some((c) => c.id === id)));
const setCats = catsStore.set;

/** Tap = only this department, long press = add/remove it (same as the person chips). */
function CategoryChip({
  cat,
  active,
  dimmed,
  onTap,
  onLongPress,
}: {
  cat: (typeof CATEGORIES)[number];
  active: boolean;
  dimmed: boolean;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const press = useTapOrLongPress(onTap, onLongPress);
  const { paint } = useStore();
  const color = paint(cat.color);
  return (
    <button
      className={`chip shop-cat-chip ${active ? 'on' : ''} ${dimmed ? 'off' : ''}`}
      style={{
        borderColor: dimmed ? undefined : color,
        background: active ? `color-mix(in srgb, ${color} 22%, var(--surface))` : undefined,
      }}
      aria-pressed={active}
      {...press}
    >
      <span className="shop-cat-icon" style={{ ['--cat' as string]: color }}>
        <Sym emoji={cat.icon} />
      </span>
      {cat.short}
    </button>
  );
}

const catColor = new Map(CATEGORIES.map((c) => [c.id, c.color]));
/** long names get a smaller font instead of a break in the middle of the word (not every device hyphenates German) */
const nameSize = (name: string) => (name.length > 13 ? 'xlong' : name.length > 10 ? 'long' : '');
const catIcon = new Map(CATEGORIES.map((c) => [c.id, c.icon]));

/** item picture in the chosen symbol style; the department icon stands in if the style lacks it */
function ItemSym({ item }: { item: ShopItem }) {
  return (
    <span className="shop-emoji">
      <Sym emoji={item.emoji} fallback={catIcon.get(item.cat)} />
    </span>
  );
}
const tileStyle = (item: ShopItem, paint: Paint): CSSProperties => ({ ['--cat' as string]: paint(catColor.get(item.cat)) ?? '#8a8f98' });

export function ShoppingModule() {
  const shop = useShopping();
  const { paint } = useStore();
  const [pane, setPane] = useState<Pane>('list');
  const [query, setQuery] = useState('');
  const [editMode, setEditMode] = useState(false);
  /** pantry filter; empty = all departments */
  const cats = usePersisted(catsStore);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ entry: ListEntry; name: string } | null>(null);
  const [creating, setCreating] = useState<{ name: string; cat: CategoryId } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const undoTimer = useRef<number | undefined>(undefined);

  const items = useMemo(() => {
    const hidden = new Set(shop.hidden);
    return [...BUILTIN.filter((i) => !hidden.has(i.id)), ...shop.custom];
  }, [shop.hidden, shop.custom]);
  const itemById = useMemo(() => new Map([...BUILTIN, ...shop.custom].map((i) => [i.id, i])), [shop.custom]);
  const qtyById = useMemo(() => new Map(shop.list.map((e) => [e.itemId, e.qty])), [shop.list]);

  // the list in supermarket order; the tile colour shows the department
  const listed = useMemo(() => {
    const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
    return shop.list
      .map((e) => ({ entry: e, item: itemById.get(e.itemId) }))
      .filter((x): x is { entry: ListEntry; item: ShopItem } => !!x.item)
      .sort((a, b) => order.get(a.item.cat)! - order.get(b.item.cat)! || a.entry.addedAt - b.entry.addedAt);
  }, [shop.list, itemById]);
  const listCount = listed.length;
  const listDensity = listCount >= 15 ? 'compact' : listCount >= 7 ? 'medium' : 'normal';
  // the list by department, in the order of the store (CATEGORIES)
  const listGroups = useMemo(() => {
    const groups: { cat: (typeof CATEGORIES)[number]; rows: typeof listed }[] = [];
    for (const row of listed) {
      const last = groups[groups.length - 1];
      if (last?.cat.id === row.item.cat) last.rows.push(row);
      else groups.push({ cat: CATEGORIES.find((c) => c.id === row.item.cat) ?? CATEGORIES[CATEGORIES.length - 1], rows: [row] });
    }
    return groups;
  }, [listed]);

  const q = norm(query);
  // "Sonstiges" only gets a chip once it has items
  const filterCats = useMemo(() => CATEGORIES.filter((c) => c.id !== 'other' || items.some((i) => i.cat === 'other')), [items]);
  const allCats = cats.length === 0;
  // a search always looks through the whole pantry, so nothing is hidden by a forgotten filter
  const catOk = useCallback((cat: CategoryId) => q !== '' || allCats || cats.includes(cat), [q, allCats, cats]);
  const pantryGroups = useMemo(() => {
    const match = (i: ShopItem) => !q || norm(i.name).includes(q);
    return CATEGORIES.filter((c) => catOk(c.id))
      .map((c) => ({ cat: c, items: items.filter((i) => i.cat === c.id && match(i)) }))
      .filter((g) => g.items.length > 0 || (!q && g.cat.id !== 'other'));
  }, [items, q, catOk]);
  const frequent = useMemo(() => {
    if (q || editMode) return [];
    return items
      .filter((i) => (shop.bought[i.id] ?? 0) >= 2 && catOk(i.cat))
      .sort((a, b) => shop.bought[b.id] - shop.bought[a.id] || a.name.localeCompare(b.name, locale()))
      .slice(0, FREQUENT_MAX);
  }, [items, shop.bought, q, editMode, catOk]);
  const exact = q && items.some((i) => norm(i.name) === q);

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const checkOff = (entry: ListEntry, item: ShopItem) => {
    if (leaving.has(entry.itemId)) return;
    setLeaving((s) => new Set(s).add(entry.itemId));
    window.setTimeout(() => {
      softly(
        () => {
          shop.check(entry.itemId);
          setLeaving((s) => {
            const n = new Set(s);
            n.delete(entry.itemId);
            return n;
          });
        },
        { items: true },
      );
      window.clearTimeout(undoTimer.current);
      setUndo({ entry, name: item.name });
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
    }, CHECK_MS);
  };

  const tapPantry = (item: ShopItem) => {
    if (editMode) {
      if (confirm(t(item.custom ? 'shopping.confirmDelete' : 'shopping.confirmHide', { name: item.name }))) shop.removeItem(item);
      return;
    }
    softly(() => shop.add(item.id), { items: true });
  };

  return (
    <>
      <div className="shop-switch segmented" role="tablist">
        <button role="tab" aria-selected={pane === 'list'} className={pane === 'list' ? 'active' : ''} onClick={() => setPane('list')}>
          {listCount > 0 ? t('shopping.listCount', { n: listCount }) : t('shopping.list')}
        </button>
        <button
          role="tab"
          aria-selected={pane === 'pantry'}
          className={pane === 'pantry' ? 'active' : ''}
          onClick={() => setPane('pantry')}
        >
          {t('shopping.pantryTab')}
        </button>
      </div>
      <div className={`shop shop-show-${pane}`}>
        {/* ---------------------------------------------------- current list */}
        <section className="view shop-list" data-density={listDensity} aria-label={t('shopping.title')}>
          <div className="shop-pane-head">
            <h2>{t('shopping.title')}</h2>
            {listCount > 0 && <span className="shop-count">{listCount}</span>}
            {listCount > 0 && (
              <button
                className="btn shop-fs-btn"
                onClick={() => setFullscreen(true)}
                aria-label={t('shopping.fullscreen')}
                title={t('shopping.fullscreen')}
              >
                <svg
                  viewBox="0 0 20 20"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" />
                </svg>
                <span>{t('shopping.fullscreen')}</span>
              </button>
            )}
          </div>
          <div className="shop-scroll">
            {listCount === 0 ? (
              <div className="shop-empty">
                <span className="shop-empty-icon">🛒</span>
                <strong>{t('shopping.empty')}</strong>
                <span className="muted">{t('shopping.emptyHint')}</span>
                <button className="btn primary shop-to-pantry" onClick={() => setPane('pantry')}>
                  {t('shopping.toPantry')}
                </button>
              </div>
            ) : (
              <>
                <div className="shop-group-head shop-list-hint">{t('shopping.tapToCheck')}</div>
                {listGroups.map(({ cat, rows }) => (
                  <div
                    key={cat.id}
                    className="shop-group shop-list-group vt-item"
                    style={{ ['--cat' as string]: paint(cat.color), ...vtItem(`shop-group-${cat.id}`) }}
                  >
                    <div className="shop-group-head">
                      <Sym emoji={cat.icon} className="shop-head-sym" /> {cat.label}
                      <span className="shop-group-n">{rows.length}</span>
                    </div>
                    <div className="shop-grid big">
                      {rows.map(({ entry, item }) => (
                        <button
                          key={item.id}
                          className={`shop-tile on-list vt-item ${leaving.has(item.id) ? 'leaving' : ''}`}
                          style={{ ...tileStyle(item, paint), ...vtItem(`shop-${item.id}`) }}
                          onClick={() => checkOff(entry, item)}
                          aria-label={
                            entry.qty > 1
                              ? t('shopping.checkQty', { name: item.name, n: entry.qty })
                              : t('shopping.check', { name: item.name })
                          }
                        >
                          <ItemSym item={item} />
                          <span className={`shop-name ${nameSize(item.name)}`}>{item.name}</span>
                          {entry.qty > 1 && <span className="shop-qty">×{entry.qty}</span>}
                          <span className="shop-check" aria-hidden>
                            ✓
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          {undo && (
            <div className="shop-toast" role="status">
              <span>
                <strong>{undo.name}</strong> {t('shopping.checked')}
              </span>
              <button
                className="btn"
                onClick={() => {
                  shop.restore(undo.entry);
                  window.clearTimeout(undoTimer.current);
                  setUndo(null);
                }}
              >
                {t('dashboard.undo')}
              </button>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------- pantry */}
        <section className={`view shop-pantry ${editMode ? 'editing' : ''}`} aria-label={t('shopping.pantry')}>
          <div className="shop-pane-head">
            <h2>{t('shopping.pantry')}</h2>
            <div className="shop-search">
              <span aria-hidden>🔍</span>
              <input
                type="search"
                value={query}
                placeholder={t('shopping.search')}
                onChange={(e) => setQuery(e.target.value)}
                enterKeyHint="search"
              />
              {query && (
                <button className="shop-search-clear" onClick={() => setQuery('')} aria-label={t('shopping.clearSearch')}>
                  ×
                </button>
              )}
            </div>
            <button className={`btn ${editMode ? 'primary' : ''}`} onClick={() => setEditMode((v) => !v)}>
              {editMode ? t('common.done') : t('common.edit')}
            </button>
          </div>
          <nav className="filterbar shop-cats" aria-label={t('shopping.categories_')}>
            <button className={`chip all ${allCats ? 'on' : ''}`} aria-pressed={allCats} onClick={() => setCats([])}>
              {t('common.all')}
            </button>
            {filterCats.map((c) => (
              <CategoryChip
                key={c.id}
                cat={c}
                active={cats.includes(c.id)}
                dimmed={!allCats && !cats.includes(c.id)}
                onTap={() => setCats((cur) => (cur.length === 1 && cur[0] === c.id ? [] : [c.id]))}
                onLongPress={() => setCats((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
              />
            ))}
          </nav>
          {editMode && (
            <div className="shop-edit-hint">
              {t('shopping.editHint')}
              {shop.hidden.length > 0 && (
                <button className="link" onClick={() => shop.unhideAll()}>
                  {t('shopping.unhide', { n: shop.hidden.length })}
                </button>
              )}
            </div>
          )}
          <div className="shop-scroll">
            {frequent.length > 0 && (
              <div className="shop-group">
                <div className="shop-group-head">
                  <span aria-hidden>⭐</span> {t('shopping.frequent')}
                </div>
                <div className="shop-grid">
                  {frequent.map((item) => (
                    <PantryTile
                      key={item.id}
                      item={item}
                      qty={qtyById.get(item.id) ?? 0}
                      editMode={false}
                      onTap={tapPantry}
                      onLess={(id, qty) => softly(() => shop.setQty(id, qty), { items: true })}
                    />
                  ))}
                </div>
              </div>
            )}
            {q && !exact && (
              <button className="shop-quick-add" onClick={() => setCreating({ name: query.trim(), cat: 'other' })}>
                <span className="shop-emoji" aria-hidden>
                  ＋
                </span>
                {t('shopping.createFromQuery', { query: query.trim() })}
              </button>
            )}
            {pantryGroups.map(({ cat, items: catItems }) => (
              <div key={cat.id} className="shop-group" style={{ ['--cat' as string]: paint(cat.color) }}>
                <div className="shop-group-head">
                  <Sym emoji={cat.icon} className="shop-head-sym" /> {cat.label}
                </div>
                <div className="shop-grid">
                  {catItems.map((item) => (
                    <PantryTile
                      key={item.id}
                      item={item}
                      qty={qtyById.get(item.id) ?? 0}
                      editMode={editMode}
                      onTap={tapPantry}
                      onLess={(id, qty) => softly(() => shop.setQty(id, qty), { items: true })}
                    />
                  ))}
                  {!q && (
                    <button
                      className="shop-tile add"
                      onClick={() => setCreating({ name: '', cat: cat.id })}
                      aria-label={t('shopping.newIn', { cat: cat.label })}
                    >
                      <span className="shop-emoji" aria-hidden>
                        ＋
                      </span>
                      <span className="shop-name">{t('shopping.new')}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!q && !pantryGroups.some((g) => g.cat.id === 'other') && !editMode && (
              <button className="shop-quick-add" onClick={() => setCreating({ name: '', cat: 'other' })}>
                <span className="shop-emoji" aria-hidden>
                  ＋
                </span>
                {t('shopping.createOwn')}
              </button>
            )}
          </div>
        </section>
      </div>
      {creating && (
        <ItemEditor
          initial={creating}
          onClose={() => setCreating(null)}
          onSave={(name, emoji, cat) => {
            const existing = items.find((i) => norm(i.name) === norm(name));
            const item = existing ?? shop.createItem(name, emoji, cat);
            shop.add(item.id);
            setCreating(null);
            setQuery('');
          }}
        />
      )}
      {fullscreen && listCount > 0 && <FullscreenList groups={listGroups} count={listCount} onClose={() => setFullscreen(false)} />}
    </>
  );
}

/** Clean, high-contrast full-screen shopping list designed for taking a quick phone photo. */
function FullscreenList({
  groups,
  count,
  onClose,
}: {
  groups: { cat: (typeof CATEGORIES)[number]; rows: { entry: ListEntry; item: ShopItem }[] }[];
  count: number;
  onClose: () => void;
}) {
  const { paint } = useStore();
  const density = count >= 28 ? 'xcompact' : count >= 16 ? 'compact' : 'normal';
  return (
    <Modal onClose={onClose} layerClass="modal-backdrop shop-fs-backdrop" label={t('shopping.title')}>
      <div className={`modal shop-fs density-${density}`}>
        <div className="shop-fs-head">
          <h2>{t('shopping.title')}</h2>
          <span className="shop-count">{count}</span>
          <span className="board-spacer" />
          <button className="btn primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="shop-fs-body">
          <div className="shop-fs-cols">
            {groups.map(({ cat, rows }) => (
              <section key={cat.id} className="shop-fs-group" style={{ ['--cat' as string]: paint(cat.color) }}>
                <header className="shop-fs-group-head">
                  <Sym emoji={cat.icon} className="shop-head-sym" />
                  <span>{cat.label}</span>
                  <span className="shop-group-n">{rows.length}</span>
                </header>
                <ul className="shop-fs-items">
                  {rows.map(({ entry, item }) => (
                    <li key={item.id} className="shop-fs-item">
                      <span className="shop-fs-sym">
                        <Sym emoji={item.emoji} fallback={cat.icon} />
                      </span>
                      <span className="shop-fs-name">{item.name}</span>
                      {entry.qty > 1 && <span className="shop-fs-qty">×{entry.qty}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PantryTile({
  item,
  qty,
  editMode,
  onTap,
  onLess,
}: {
  item: ShopItem;
  qty: number;
  editMode: boolean;
  onTap: (item: ShopItem) => void;
  onLess: (itemId: string, qty: number) => void;
}) {
  const { paint } = useStore();
  return (
    <div className="shop-tile-wrap">
      <button
        className={`shop-tile ${qty > 0 ? 'picked' : ''} ${editMode ? 'removable' : ''}`}
        style={tileStyle(item, paint)}
        onClick={() => onTap(item)}
        aria-label={
          editMode
            ? t('shopping.removeItem', { name: item.name })
            : qty > 0
              ? t('shopping.oneMore', { name: item.name, n: qty })
              : t('shopping.addToList', { name: item.name })
        }
      >
        <ItemSym item={item} />
        <span className={`shop-name ${nameSize(item.name)}`}>{item.name}</span>
        {!editMode && qty > 0 && <span className="shop-qty">{qty > 1 ? `×${qty}` : '✓'}</span>}
        {editMode && (
          <span className="shop-remove" aria-hidden>
            ×
          </span>
        )}
      </button>
      {!editMode && qty > 0 && (
        <button className="shop-less" onClick={() => onLess(item.id, qty - 1)} aria-label={t('shopping.oneLess', { name: item.name })}>
          −
        </button>
      )}
    </div>
  );
}

function ItemEditor({
  initial,
  onSave,
  onClose,
}: {
  initial: { name: string; cat: CategoryId };
  onSave: (name: string, emoji: string, cat: CategoryId) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [cat, setCat] = useState<CategoryId>(initial.cat);
  const [emoji, setEmoji] = useState(() => CATEGORIES.find((c) => c.id === initial.cat)?.icon ?? '🛒');
  const ref = useRef<HTMLInputElement>(null);
  const { paint } = useStore();
  useEffect(() => ref.current?.focus(), []);
  const valid = name.trim().length > 0;
  const save = () => valid && onSave(name.trim(), emoji, cat);

  return (
    <Modal onClose={onClose} label={t('shopping.newItem')}>
      <div className="modal shop-editor" style={{ ['--cat' as string]: paint(catColor.get(cat)) }}>
        <div className="shop-editor-preview" style={{ ['--cat' as string]: paint(catColor.get(cat)) }}>
          <span className="shop-emoji">
            <Sym emoji={emoji} />
          </span>
          <input
            ref={ref}
            value={name}
            maxLength={40}
            placeholder={t('shopping.itemName')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        <div className="todo-editor-section">
          <div className="muted small">{t('shopping.picture')}</div>
          <div className="shop-emoji-grid">
            {EMOJI_CHOICES.map((e) => (
              <button key={e} className={emoji === e ? 'on' : ''} onClick={() => setEmoji(e)} aria-pressed={emoji === e} aria-label={e}>
                <Sym emoji={e} />
              </button>
            ))}
          </div>
        </div>
        <div className="todo-editor-section">
          <div className="muted small">{t('shopping.where')}</div>
          <div className="todo-editor-members">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`chip ${cat === c.id ? 'on' : 'off'}`}
                style={{ paddingLeft: 12, borderColor: cat === c.id ? paint(c.color) : undefined }}
                aria-pressed={cat === c.id}
                onClick={() => setCat(c.id)}
              >
                {c.icon} {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-actions todo-editor-actions">
          <span className="board-spacer" />
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={save} disabled={!valid}>
            {t('shopping.onList')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
