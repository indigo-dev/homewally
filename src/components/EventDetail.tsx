import { useState } from 'react';
import type { CalEvent, Member } from '../types';
import { useStore } from '../store';
import { addDays, fmt, fmtTime, isSameDay } from '../lib/dates';
import { useLocalEvents } from '../lib/localEvents';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { t } from '../i18n';

export function describeWhen(e: CalEvent): string {
  if (e.allDay) {
    const last = addDays(e.end, -1);
    const d = (x: Date) => fmt(x, { weekday: 'short', day: 'numeric', month: 'long' });
    return isSameDay(e.start, last) ? `${d(e.start)} · ${t('common.allDay')}` : `${d(e.start)} – ${d(last)} · ${t('common.allDay')}`;
  }
  if (isSameDay(e.start, e.end)) {
    return `${fmt(e.start, { weekday: 'short', day: 'numeric', month: 'long' })} · ${fmtTime(e.start)} – ${fmtTime(e.end)}`;
  }
  const d = (x: Date) => `${fmt(x, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(x)}`;
  return `${d(e.start)} – ${d(e.end)}`;
}

export function EventDetail({
  event,
  onClose,
  onEdit,
  onDelete,
  onEditBirthday,
  onDeleteBirthday,
}: {
  event: CalEvent;
  onClose: () => void;
  onEdit?: (localId: string) => void;
  onDelete?: (localId: string) => void;
  onEditBirthday?: (birthdayId: string) => void;
  onDeleteBirthday?: (birthdayId: string) => void;
}) {
  const { memberById } = useStore();
  const { events: locals } = useLocalEvents();
  const [askDelete, setAskDelete] = useState(false);
  const members = event.memberIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m);
  const localSource = event.localId ? locals.find((x) => x.id === event.localId) : undefined;
  const isBday = Boolean(event.birthdayId);
  const barColor = isBday ? 'var(--bday, #ec4899)' : members[0]?.color;
  const canDelete = (event.localId && onDelete) || (event.birthdayId && onDeleteBirthday);
  return (
    <Modal onClose={onClose} label={event.title}>
      <div className="modal event-detail">
        <div className="event-detail-bar" style={{ background: barColor }} />
        <h2>
          {isBday && <span aria-hidden>🎂 </span>}
          {event.title}
        </h2>
        <p className="muted">
          {describeWhen(event)}
          {isBday
            ? ` · ${t('calendar.local.repeat.yearly')}`
            : localSource && localSource.repeat !== 'none'
              ? ` · ${t(`calendar.local.repeat.${localSource.repeat}`)}`
              : ''}
        </p>
        {event.location && <p>📍 {event.location}</p>}
        {members.length > 0 && (
          <div className="event-detail-members">
            {members.map((m) => (
              <span key={m.id} className="chip static">
                <Avatar member={m} size={26} ring={false} />
                {m.name}
              </span>
            ))}
          </div>
        )}
        {event.notes && <p className="event-notes">{event.notes}</p>}
        {event.calendarName && <p className="muted small">{t('calendar.calendarOf', { name: event.calendarName })}</p>}
        <div className="modal-actions">
          {canDelete && (
            <button className="btn danger" onClick={() => setAskDelete(true)}>
              {t('common.delete')}
            </button>
          )}
          {event.localId && onEdit && (
            <button className="btn" onClick={() => onEdit(event.localId!)}>
              {t('common.edit')}
            </button>
          )}
          {event.birthdayId && onEditBirthday && (
            <button className="btn" onClick={() => onEditBirthday(event.birthdayId!)}>
              {t('common.edit')}
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
      {askDelete && canDelete && (
        <ConfirmDialog
          title={isBday ? t('calendar.birthdays.deleteOneTitle') : t('calendar.local.deleteOneTitle')}
          confirmLabel={t('common.delete')}
          onConfirm={() => {
            setAskDelete(false);
            if (event.birthdayId && onDeleteBirthday) onDeleteBirthday(event.birthdayId);
            else if (event.localId && onDelete) onDelete(event.localId);
          }}
          onClose={() => setAskDelete(false)}
        >
          <p>
            {isBday
              ? t('calendar.birthdays.deleteOneConfirm', { name: event.title })
              : t('calendar.local.deleteOneConfirm', { title: event.title })}
          </p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}
