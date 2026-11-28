import type { CalEvent, Member } from '../types';
import { LocalMark } from '../components/Icon';
import { t } from '../i18n';

/** Filled chip for all-day events; shared events show a dot per additional member. */
export function AllDayChip({ e, members, onClick }: { e: CalEvent; members: Member[]; onClick: () => void }) {
  const isBday = Boolean(e.birthdayId);
  return (
    <button
      className={`chip-event solid ${e.localId ? 'local' : ''} ${isBday ? 'birthday' : ''}`}
      style={{ background: isBday ? 'var(--bday, #ec4899)' : (members[0]?.color ?? '#888') }}
      onClick={onClick}
    >
      {members.length > 1 && (
        <span className="dots ring">
          {members.slice(1).map((m) => (
            <span key={m.id} className="dot" style={{ background: m.color }} />
          ))}
        </span>
      )}
      {isBday && (
        <span className="bday-mark" aria-hidden>
          🎂
        </span>
      )}
      {e.localId && <LocalMark title={t('calendar.local.badge')} />}
      {e.title}
    </button>
  );
}
