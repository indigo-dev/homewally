import { useState } from 'react';
import type { Birthday } from '../lib/birthdays';
import { fmt } from '../lib/dates';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { t } from '../i18n';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function BirthdayEditor({
  initial,
  isNew,
  onSave,
  onDelete,
  onClose,
  onSwitchToEvent,
}: {
  initial: Birthday;
  isNew: boolean;
  onSave: (b: Birthday) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** when creating from the calendar, switch to a normal local event */
  onSwitchToEvent?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);
  const [year, setYear] = useState(initial.year ? String(initial.year) : '');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [askDelete, setAskDelete] = useState(false);

  const maxDay = MAX_DAYS[month - 1] ?? 31;
  const clampedDay = Math.min(day, maxDay);

  const onMonthChange = (nextMonth: number) => {
    setMonth(nextMonth);
    const limit = MAX_DAYS[nextMonth - 1] ?? 31;
    if (day > limit) setDay(limit);
  };

  const parsedYear = year.trim() ? Number(year.trim()) : undefined;
  const yearValid = parsedYear === undefined || (Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100);
  const canSave = name.trim().length > 0 && yearValid;

  const save = () => {
    if (!canSave) return;
    onSave({
      ...initial,
      name: name.trim(),
      month,
      day: clampedDay,
      year: parsedYear,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal onClose={onClose} label={isNew ? t('calendar.birthdays.newTitle') : t('calendar.birthdays.editTitle')}>
      <div className="modal event-editor">
        <div className="event-editor-head">
          <h2>{isNew ? t('calendar.birthdays.newTitle') : t('calendar.birthdays.editTitle')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        {isNew && onSwitchToEvent && (
          <div className="segmented event-kind-switch" role="tablist">
            <button type="button" role="tab" aria-selected={false} onClick={onSwitchToEvent}>
              {t('calendar.local.kindEvent')}
            </button>
            <button type="button" role="tab" aria-selected className="active">
              🎂 {t('calendar.birthdays.kindBirthday')}
            </button>
          </div>
        )}

        <div className="event-editor-body">
          <label className="event-field">
            <span>{t('calendar.birthdays.nameLabel')}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('calendar.birthdays.namePlaceholder')}
              autoFocus
            />
          </label>

          <div className="event-editor-grid timed">
            <label className="event-field">
              <span>{t('calendar.birthdays.dayLabel')}</span>
              <select value={clampedDay} onChange={(e) => setDay(Number(e.target.value))}>
                {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}.
                  </option>
                ))}
              </select>
            </label>
            <label className="event-field">
              <span>{t('calendar.birthdays.monthLabel')}</span>
              <select value={month} onChange={(e) => onMonthChange(Number(e.target.value))}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {fmt(new Date(2026, m - 1, 1), { month: 'long' })}
                  </option>
                ))}
              </select>
            </label>
            <label className="event-field">
              <span>{t('calendar.birthdays.yearLabel')}</span>
              <input
                type="number"
                min={1900}
                max={2100}
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder={t('calendar.birthdays.yearPlaceholder')}
              />
            </label>
          </div>

          <label className="event-field">
            <span>{t('calendar.local.notesLabel')}</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('calendar.birthdays.notesPlaceholder')}
            />
          </label>

          <p className="muted small event-editor-note">{t('calendar.birthdays.localOnlyNote')}</p>
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
          title={t('calendar.birthdays.deleteOneTitle')}
          confirmLabel={t('common.delete')}
          onConfirm={() => {
            setAskDelete(false);
            onDelete();
          }}
          onClose={() => setAskDelete(false)}
        >
          <p>{t('calendar.birthdays.deleteOneConfirm', { name: initial.name })}</p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}
