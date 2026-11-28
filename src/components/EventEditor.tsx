import { useState } from 'react';
import { RECURRENCES, type LocalEvent, type Recurrence } from '../lib/localEvents';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { Switch } from '../settings/controls';
import { t } from '../i18n';

/** Adds 1 hour to an HH:MM string (clamped to 23:59). */
function plusOneHour(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '10:00';
  const total = Math.min(23 * 60 + 59, h * 60 + m + 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function EventEditor({
  initial,
  isNew,
  onSave,
  onDelete,
  onClose,
}: {
  initial: LocalEvent;
  isNew: boolean;
  onSave: (ev: LocalEvent) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { members } = useStore();
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [endDate, setEndDate] = useState(initial.endDate ?? initial.date);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startTime, setStartTime] = useState(initial.startTime ?? '15:00');
  const [endTime, setEndTime] = useState(initial.endTime ?? plusOneHour(initial.startTime ?? '15:00'));
  const [repeat, setRepeat] = useState<Recurrence>(initial.repeat);
  const [memberIds, setMemberIds] = useState<string[]>(() => {
    const valid = initial.memberIds.filter((id) => members.some((m) => m.id === id));
    return valid.length ? valid : members.map((m) => m.id);
  });
  const [location, setLocation] = useState(initial.location ?? '');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [askDelete, setAskDelete] = useState(false);

  const allSelected = members.length > 0 && memberIds.length === members.length;

  const toggleMember = (id: string) => {
    setMemberIds((cur) => {
      if (cur.includes(id)) return cur.length > 1 ? cur.filter((x) => x !== id) : cur;
      return [...cur, id];
    });
  };

  const toggleAll = () => {
    if (allSelected && members.length > 0) setMemberIds([members[0].id]);
    else setMemberIds(members.map((m) => m.id));
  };

  const onStartChange = (next: string) => {
    setStartTime(next);
    if (endTime <= next) setEndTime(plusOneHour(next));
  };

  const onDateChange = (next: string) => {
    setDate(next);
    if (endDate < next) setEndDate(next);
  };

  const canSave = title.trim().length > 0 && !!date && memberIds.length > 0;

  const save = () => {
    if (!canSave) return;
    const trimmedTitle = title.trim();
    const trimmedLoc = location.trim();
    const trimmedNotes = notes.trim();
    onSave({
      ...initial,
      title: trimmedTitle,
      date,
      endDate: allDay && endDate > date ? endDate : undefined,
      allDay,
      startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime > startTime ? endTime : plusOneHour(startTime),
      repeat,
      memberIds,
      location: trimmedLoc || undefined,
      notes: trimmedNotes || undefined,
    });
  };

  return (
    <Modal onClose={onClose} label={isNew ? t('calendar.local.newTitle') : t('calendar.local.editTitle')}>
      <div className="modal event-editor">
        <div className="event-editor-head">
          <h2>{isNew ? t('calendar.local.newTitle') : t('calendar.local.editTitle')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        <div className="event-editor-body">
          <label className="event-field">
            <span>{t('calendar.local.titleLabel')}</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('calendar.local.titlePlaceholder')}
              autoFocus
            />
          </label>

          <div className="event-field">
            <span>{t('calendar.local.whoLabel')}</span>
            <div className="event-editor-members">
              {members.length > 1 && (
                <button type="button" className={`chip all ${allSelected ? 'on' : ''}`} aria-pressed={allSelected} onClick={toggleAll}>
                  {t('common.all')}
                </button>
              )}
              {members.map((m) => {
                const on = memberIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`chip ${on ? 'on' : 'off'}`}
                    style={{
                      borderColor: on ? m.color : undefined,
                      background: on ? `color-mix(in srgb, ${m.color} 20%, var(--surface))` : undefined,
                    }}
                    aria-pressed={on}
                    onClick={() => toggleMember(m.id)}
                  >
                    <Avatar member={m} size={24} ring={false} />
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="event-editor-row">
            <span>{t('common.allDay')}</span>
            <Switch checked={allDay} onChange={setAllDay} label={t('common.allDay')} />
          </div>

          {allDay ? (
            <div className="event-editor-grid">
              <label className="event-field">
                <span>{t('calendar.local.startDate')}</span>
                <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
              </label>
              <label className="event-field">
                <span>{t('calendar.local.endDate')}</span>
                <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
          ) : (
            <div className="event-editor-grid timed">
              <label className="event-field">
                <span>{t('calendar.local.dateLabel')}</span>
                <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
              </label>
              <label className="event-field">
                <span>{t('calendar.local.fromTime')}</span>
                <input type="time" value={startTime} onChange={(e) => onStartChange(e.target.value)} />
              </label>
              <label className="event-field">
                <span>{t('calendar.local.toTime')}</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </div>
          )}

          <div className="event-field">
            <span>{t('calendar.local.repeatLabel')}</span>
            <div className="segmented event-repeat" role="radiogroup" aria-label={t('calendar.local.repeatLabel')}>
              {RECURRENCES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={repeat === r}
                  className={repeat === r ? 'active' : ''}
                  onClick={() => setRepeat(r)}
                >
                  {t(`calendar.local.repeat.${r}`)}
                </button>
              ))}
            </div>
          </div>

          <label className="event-field">
            <span>{t('calendar.local.locationLabel')}</span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('calendar.local.locationPlaceholder')}
            />
          </label>

          <label className="event-field">
            <span>{t('calendar.local.notesLabel')}</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('calendar.local.notesPlaceholder')}
            />
          </label>

          <p className="muted small event-editor-note">{t('calendar.local.localOnlyNote')}</p>
        </div>

        <div className="modal-actions event-editor-actions">
          {!isNew && onDelete && (
            <button type="button" className="btn danger" onClick={() => setAskDelete(true)}>
              {t('common.delete')}
            </button>
          )}
          <span className="board-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={!canSave} onClick={save}>
            {t('common.save')}
          </button>
        </div>
      </div>

      {askDelete && onDelete && (
        <ConfirmDialog
          title={t('calendar.local.deleteOneTitle')}
          confirmLabel={t('common.delete')}
          onConfirm={() => {
            setAskDelete(false);
            onDelete();
          }}
          onClose={() => setAskDelete(false)}
        >
          <p>{t('calendar.local.deleteOneConfirm', { title: initial.title })}</p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}
