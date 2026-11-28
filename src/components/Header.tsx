import { useEffect, useRef, type ReactNode } from 'react';
import { softly } from '../lib/transition';
import { useTapOrLongPress } from '../lib/hooks';
import type { Member, ViewMode } from '../types';
import { fmt, fmtTime } from '../lib/dates';
import { useMinute } from '../lib/clock';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { GlyphIcon } from './Icon';
import { WeatherChip } from '../weather/WeatherChip';
import { t } from '../i18n';

const VIEWS: ViewMode[] = ['days', 'week', 'month', 'year', 'agenda'];

interface Props {
  title: string;
  view: ViewMode;
  loading: boolean;
  /** day count of the 'days' view */
  multiDays: number;
  onMultiDays: (n: number) => void;
  onView: (v: ViewMode) => void;
  onStep: (dir: 1 | -1) => void;
  onToday: () => void;
  onRefresh: () => void;
  onSettings: () => void;
  onWeather: () => void;
  /** creates a new event in the local family calendar (omitted when disabled) */
  onAddEvent?: () => void;
  /** person filter – shares the second row with the view switch, so the title gets the first row */
  filter?: ReactNode;
  /** today is outside the visible range – then "Heute" is the one action that glows */
  away?: boolean;
}

export function Header({
  title,
  view,
  loading,
  multiDays,
  onMultiDays,
  onView,
  onStep,
  onToday,
  onRefresh,
  onSettings,
  onWeather,
  onAddEvent,
  filter,
  away = false,
}: Props) {
  const isDaysActive = view === 'day' || view === 'days';
  const activeDays = view === 'day' ? 1 : multiDays;

  return (
    <>
      <header className="topbar cal-topbar">
        <div className="topbar-left">
          <Title text={title} />
          <div className="nav">
            <button className="icon-btn" onClick={() => onStep(-1)} aria-label={t('common.back')}>
              <GlyphIcon glyph="‹" name="back" />
            </button>
            <button className={`btn ${away ? 'away' : ''}`} onClick={onToday}>
              {t('common.today')}
            </button>
            <button className="icon-btn" onClick={() => onStep(1)} aria-label={t('common.forward')}>
              <GlyphIcon glyph="›" name="forward" />
            </button>
          </div>
        </div>
        <div className="topbar-right">
          {onAddEvent && (
            <button className="btn primary cal-add-btn" onClick={onAddEvent}>
              {t('calendar.local.addBtn')}
            </button>
          )}
          <WeatherChip onClick={onWeather} />
          <Clock />
          <button className={`icon-btn ${loading ? 'spin' : ''}`} onClick={onRefresh} aria-label={t('common.refresh')}>
            <GlyphIcon glyph="⟳" name="refresh" />
          </button>
          <button className="icon-btn" onClick={onSettings} aria-label={t('common.settings')}>
            <GlyphIcon glyph="⚙" name="settings" />
          </button>
        </div>
      </header>
      <div className="cal-bar">
        {filter}
        <div className="segmented" role="tablist">
          {VIEWS.map((v) =>
            v === 'days' && isDaysActive ? (
              // active 1–6 days tab: − / + change the number of days (1 = single day view)
              <span key={v} role="tab" aria-selected className="active seg-days">
                <button
                  className="seg-step"
                  onClick={() => onMultiDays(activeDays - 1)}
                  disabled={activeDays <= 1}
                  aria-label={t('calendar.fewerDays')}
                >
                  −
                </button>
                <span>{t('calendar.nDays', { n: activeDays })}</span>
                <button
                  className="seg-step"
                  onClick={() => onMultiDays(activeDays + 1)}
                  disabled={activeDays >= 6}
                  aria-label={t('calendar.moreDays')}
                >
                  +
                </button>
              </span>
            ) : (
              <button
                key={v}
                role="tab"
                aria-selected={v === 'days' ? isDaysActive : view === v}
                className={view === v ? 'active' : ''}
                onClick={() => onView(v)}
              >
                {v === 'days' ? t('calendar.nDays', { n: multiDays }) : t(`calendar.views.${v}`)}
              </button>
            ),
          )}
        </div>
      </div>
    </>
  );
}

/** "November 2026" -> month bold, year as its own span (some styles set it lighter). */
function Title({ text }: { text: string }) {
  const m = /^(.*\S)\s+(\d{4})$/.exec(text);
  return (
    <h1 className="title">
      {m ? (
        <>
          {m[1]} <span className="title-year">{m[2]}</span>
        </>
      ) : (
        text
      )}
    </h1>
  );
}

/** Time and date; the only part of the header that changes every minute. */
function Clock() {
  const now = useMinute();
  return (
    <div className="clock">
      <span className="clock-time">{fmtTime(now)}</span>
      <span className="clock-date">{fmt(now, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </div>
  );
}

/** Simple header for modules without date navigation (to-dos, ...). */
export function ModuleHeader({
  title,
  onSettings,
  actions,
  clock = true,
}: {
  title: ReactNode;
  onSettings: () => void;
  actions?: ReactNode;
  clock?: boolean;
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="title">{title}</h1>
      </div>
      <div className="topbar-right">
        {clock && <Clock />}
        {actions}
        <button className="icon-btn" onClick={onSettings} aria-label={t('common.settings')}>
          <GlyphIcon glyph="⚙" name="settings" />
        </button>
      </div>
    </header>
  );
}

/** Tap = only this person, long press = add/remove this person to/from the selection. */
/** Person chip of the filter bars: tap = only this person, long press = add / remove. */
export function MemberChip({
  member,
  active,
  dimmed,
  disabled,
  onTap,
  onLongPress,
}: {
  member: Member;
  active: boolean;
  dimmed: boolean;
  disabled?: boolean;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const press = useTapOrLongPress(onTap, onLongPress);
  return (
    <button
      className={`chip ${active ? 'on' : ''} ${dimmed ? 'off' : ''}`}
      style={{
        borderColor: dimmed ? undefined : member.color,
        background: active ? `color-mix(in srgb, ${member.color} 22%, var(--surface))` : undefined,
      }}
      aria-pressed={active}
      disabled={disabled}
      {...press}
    >
      <Avatar member={member} size={30} ring={false} />
      {member.name}
    </button>
  );
}

export function MemberFilter({ issues, onIssue }: { issues: Record<string, string>; onIssue: (message: string) => void }) {
  const { members, selectedIds, selectOnly, toggleSelected, showAll } = useStore();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      el.dataset.fade = left && right ? 'both' : left ? 'left' : right ? 'right' : 'none';
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [members.length]);

  if (members.length === 0) return null;
  const all = selectedIds.size === 0;
  return (
    <nav ref={ref} className="filterbar" aria-label={t('calendar.memberFilter')}>
      {' '}
      <button className={`chip all ${all ? 'on' : ''}`} aria-pressed={all} onClick={() => softly(showAll)}>
        {t('common.all')}
      </button>
      {members.map((m) => {
        const active = selectedIds.has(m.id);
        const issue = issues[m.id];
        return (
          <span key={m.id} className="chip-wrap">
            <MemberChip
              member={m}
              active={active}
              dimmed={!all && !active}
              onTap={() => softly(() => selectOnly(m.id))}
              onLongPress={() => softly(() => toggleSelected(m.id))}
            />
            {issue && (
              <button className="warn-badge error" title={issue} onClick={() => onIssue(t('calendar.notLoaded', { name: m.name, issue }))}>
                !
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
