import type { CalEvent, Member } from '../../types';
import { useStore } from '../../store';
import { addDays, fmt, startOfDay } from '../../lib/dates';
import { AvatarStack } from '../../components/Avatar';
import { LocalMark } from '../../components/Icon';
import { gradient, Head, hhmm, useDash, type WidgetProps } from './shared';
import { useMinute } from '../../lib/clock';
import { t } from '../../i18n';

function EventRow({ e, now, byId }: { e: CalEvent; now: Date; byId: Map<string, Member> }) {
  const ms = e.memberIds.map((id) => byId.get(id)!).filter(Boolean);
  const running = !e.allDay && e.start <= now && e.end > now;
  return (
    <div className={`dw-event ${running ? 'running' : ''}`}>
      <span className="dw-event-bar" style={{ background: e.birthdayId ? 'var(--bday, #ec4899)' : gradient(ms) }} />
      <span className="dw-event-time">{e.allDay ? t('common.allDay') : running ? t('dashboard.now') : hhmm(e.start)}</span>
      <span className="dw-event-title">
        {e.birthdayId && (
          <span className="bday-mark" aria-hidden>
            🎂
          </span>
        )}
        {e.localId && <LocalMark title={t('calendar.local.badge')} />}
        {e.title}
      </span>
      <AvatarStack members={ms} size={20} />
    </div>
  );
}

export function EventsWidget({ size }: WidgetProps) {
  const { events } = useDash();
  const now = useMinute();
  const { memberById } = useStore();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const todays = events.filter((e) => e.end > now && e.start < tomorrow);
  const tomorrows = events.filter((e) => e.start < addDays(tomorrow, 1) && e.end > tomorrow);

  const group = (label: string, list: CalEvent[], none: string) => (
    <div className="dw-group">
      <div className="dw-group-label">{label}</div>
      {list.length === 0 ? (
        <div className="dw-none">{none}</div>
      ) : (
        list.map((e) => <EventRow key={e.key} e={e} now={now} byId={memberById} />)
      )}
    </div>
  );

  return (
    <div className={`dw-events ${size}`}>
      <Head icon="📅" title={t('dashboard.widgets.events.title')} meta={fmt(now, { weekday: 'short', day: 'numeric', month: 'short' })} />
      <div className={`dw-body dw-scroll ${size === 'xl' ? 'two-col' : ''}`}>
        {group(t('common.today'), todays, t('dashboard.nothingPlanned'))}
        {group(t('dashboard.tomorrowDay', { day: fmt(tomorrow, { weekday: 'long' }) }), tomorrows, t('dashboard.stillFree'))}
      </div>
    </div>
  );
}
