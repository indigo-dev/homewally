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
}: {
  event: CalEvent;
  onClose: () => void;
  onEdit?: (localId: string) => void;
  onDelete?: (localId: string) => void;
}) {
  const { memberById } = useStore();
  const { events: locals } = useLocalEvents();
  const [askDelete, setAskDelete] = useState(false);
  const members = event.memberIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m);
  const localSource = event.localId ? locals.find((x) => x.id === event.localId) : undefined;
  return (
    <Modal onClose={onClose} label={event.title}>
      <div className="modal event-detail">
        <div className="event-detail-bar" style={{ background: members[0]?.color }} />
        <h2>{event.title}</h2>
        <p className="muted">
          {describeWhen(event)}
          {localSource && localSource.repeat !== 'none' ? ` · ${t(`calendar.local.repeat.${localSource.repeat}`)}` : ''}
        </p>
        {event.location && <p>📍 {event.location}</p>}
        <div className="event-detail-members">
          {members.map((m) => (
            <span key={m.id} className="chip static">
              <Avatar member={m} size={26} ring={false} />
              {m.name}
            </span>
          ))}
        </div>
        {event.notes && <p className="event-notes">{event.notes}</p>}
        {event.calendarName && <p className="muted small">{t('calendar.calendarOf', { name: event.calendarName })}</p>}
        <div className="modal-actions">
          {event.localId && onDelete && (
            <button className="btn danger" onClick={() => setAskDelete(true)}>
              {t('common.delete')}
            </button>
          )}
          {event.localId && onEdit && (
            <button className="btn" onClick={() => onEdit(event.localId!)}>
              {t('common.edit')}
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
      {askDelete && event.localId && onDelete && (
        <ConfirmDialog
          title={t('calendar.local.deleteOneTitle')}
          confirmLabel={t('common.delete')}
          onConfirm={() => {
            setAskDelete(false);
            onDelete(event.localId!);
          }}
          onClose={() => setAskDelete(false)}
        >
          <p>{t('calendar.local.deleteOneConfirm', { title: event.title })}</p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}
