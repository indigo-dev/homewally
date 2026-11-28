import type { CalEvent, Member } from '../types';
import { LocalMark } from '../components/Icon';
import { t } from '../i18n';

/** Filled chip for all-day events; shared events show a dot per additional member. */
export function AllDayChip({ e, members, onClick }: { e: CalEvent; members: Member[]; onClick: () => void }) {
  return (
    <button
      className={`chip-event solid ${e.localId ? 'local' : ''}`}
      style={{ background: members[0]?.color ?? '#888' }}
      onClick={onClick}
    >
      {members.length > 1 && (
        <span className="dots ring">
          {members.slice(1).map((m) => (
            <span key={m.id} className="dot" style={{ background: m.color }} />
          ))}
        </span>
      )}
      {e.localId && <LocalMark title={t('calendar.local.badge')} />}
      {e.title}
    </button>
  );
}
