import { useStore } from '../store';
import { updateGamesSettings, useGamesSettings } from '../games/store';
import { playSound, REMINDER_LEADS, updateSoundSettings, useSoundSettings } from '../lib/sounds';
import { Group, Row, Stepper, Switch } from './controls';
import { LANGUAGES, resolveLanguage, t, withLanguage, type LanguageSetting } from '../i18n';
import { useMinute } from '../lib/clock';
import { fmt, fmtTime } from '../lib/dates';

/** Today's date and time as the language writes it – the preview of a language card. */
function languageSample(setting: LanguageSetting, now: Date): string {
  return withLanguage(
    resolveLanguage(setting),
    () => `${fmt(now, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(now)}`,
  );
}

export function DeviceTab() {
  const { settings, updateSettings } = useStore();
  const now = useMinute();
  const deviceName = LANGUAGES.find((l) => l.id === resolveLanguage('auto'))!.label;
  const options: { id: LanguageSetting; label: string; note: string }[] = [
    { id: 'auto', label: t('settings.device.auto'), note: t('settings.device.autoNote', { language: deviceName }) },
    ...LANGUAGES.map((l) => ({ id: l.id, label: l.label, note: '' })),
  ];
  return (
    <div className="form">
      <Group title={t('settings.device.language')}>
        <div className="pick-grid three" role="radiogroup" aria-label={t('settings.device.language')}>
          {options.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={settings.language === o.id}
              className={`pick-card ${settings.language === o.id ? 'on' : ''}`}
              onClick={() => updateSettings({ language: o.id })}
            >
              <span className="lang-thumb" aria-hidden>
                {languageSample(o.id, now)}
              </span>
              <span className="pick-label">{o.label}</span>
              {o.note && <span className="pick-note">{o.note}</span>}
            </button>
          ))}
        </div>
      </Group>
      <Group>
        <div className="set-card">
          <Row label={t('settings.device.refresh')} hint={t('settings.device.refreshHint')}>
            <Stepper
              value={settings.refreshMinutes}
              min={1}
              max={120}
              unit={t('common.minutesShort')}
              onChange={(v) => updateSettings({ refreshMinutes: v })}
            />
          </Row>
          <Row label={t('settings.device.idle')} hint={t('settings.device.idleHint')}>
            <Stepper
              value={settings.idleResetMinutes}
              min={0}
              max={120}
              unit={t('common.minutesShort')}
              onChange={(v) => updateSettings({ idleResetMinutes: v })}
            />
          </Row>
          <Row label={t('settings.device.keepAwake')} hint={t('settings.device.keepAwakeHint')}>
            <Switch
              checked={settings.keepAwake}
              onChange={(keepAwake) => updateSettings({ keepAwake })}
              label={t('settings.device.keepAwake')}
            />
          </Row>
        </div>
      </Group>
      <SoundRemindersGroup />
      <GamesGroup />
    </div>
  );
}

/** Sounds, quiet hours and calendar event reminders on this device. */
function SoundRemindersGroup() {
  const s = useSoundSettings();
  return (
    <>
      <Group title={t('settings.device.soundsTitle')} note={t('settings.device.soundsNote')}>
        <div className="set-card">
          <Row label={t('settings.device.soundsEnable')} hint={t('settings.device.soundsEnableHint')}>
            <Switch
              checked={s.enabled}
              onChange={(enabled) => {
                updateSoundSettings({ enabled });
                if (enabled) playSound('todoDone', { force: true });
              }}
              label={t('settings.device.soundsEnable')}
            />
          </Row>
          {s.enabled && (
            <>
              <Row label={t('settings.device.soundsVolume')}>
                <div className="sound-vol-row">
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={Math.round(s.volume * 100)}
                    onChange={(e) => updateSoundSettings({ volume: Number(e.target.value) / 100 })}
                    aria-label={t('settings.device.soundsVolume')}
                  />
                  <span className="sound-vol-pct">{Math.round(s.volume * 100)} %</span>
                  <button type="button" className="btn" onClick={() => playSound('todoDone', { force: true })}>
                    {t('settings.device.soundsTest')}
                  </button>
                </div>
              </Row>
              <Row label={t('settings.device.soundsActions')} hint={t('settings.device.soundsActionsHint')}>
                <Switch
                  checked={s.actions}
                  onChange={(actions) => updateSoundSettings({ actions })}
                  label={t('settings.device.soundsActions')}
                />
              </Row>
              <Row label={t('settings.device.soundsGames')} hint={t('settings.device.soundsGamesHint')}>
                <Switch checked={s.games} onChange={(games) => updateSoundSettings({ games })} label={t('settings.device.soundsGames')} />
              </Row>
            </>
          )}
          <Row label={t('settings.device.quietHours')} hint={t('settings.device.quietHoursHint')}>
            <Switch
              checked={s.quietEnabled}
              onChange={(quietEnabled) => updateSoundSettings({ quietEnabled })}
              label={t('settings.device.quietHours')}
            />
          </Row>
          {s.quietEnabled && (
            <>
              <Row label={t('settings.device.quietFrom')}>
                <Stepper
                  value={s.quietFrom}
                  min={0}
                  max={23}
                  unit={t('settings.device.oClock')}
                  onChange={(quietFrom) => updateSoundSettings({ quietFrom })}
                />
              </Row>
              <Row label={t('settings.device.quietTo')}>
                <Stepper
                  value={s.quietTo}
                  min={0}
                  max={23}
                  unit={t('settings.device.oClock')}
                  onChange={(quietTo) => updateSoundSettings({ quietTo })}
                />
              </Row>
            </>
          )}
        </div>
      </Group>

      <Group title={t('settings.device.remindersTitle')} note={t('settings.device.remindersNote')}>
        <div className="set-card">
          <Row label={t('settings.device.remindersEnable')} hint={t('settings.device.remindersEnableHint')}>
            <Switch
              checked={s.remindersEnabled}
              onChange={(remindersEnabled) => updateSoundSettings({ remindersEnabled })}
              label={t('settings.device.remindersEnable')}
            />
          </Row>
          {s.remindersEnabled && (
            <>
              <Row label={t('settings.device.remindersLead')} hint={t('settings.device.remindersLeadHint')}>
                <div className="segmented reminder-leads" role="radiogroup" aria-label={t('settings.device.remindersLead')}>
                  {REMINDER_LEADS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={s.reminderMinutes === m}
                      className={s.reminderMinutes === m ? 'active' : ''}
                      onClick={() => updateSoundSettings({ reminderMinutes: m })}
                    >
                      {m === 0 ? t('settings.device.remindersAtStart') : `${m} ${t('common.minutesShort')}`}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label={t('settings.device.remindersSound')} hint={t('settings.device.remindersSoundHint')}>
                <div className="sound-vol-row">
                  <button type="button" className="btn" onClick={() => playSound('reminder', { force: true })}>
                    {t('settings.device.soundsTest')}
                  </button>
                  <Switch
                    checked={s.reminderSound}
                    onChange={(reminderSound) => updateSoundSettings({ reminderSound })}
                    label={t('settings.device.remindersSound')}
                  />
                </div>
              </Row>
              <Row label={t('settings.device.remindersSpeak')} hint={t('settings.device.remindersSpeakHint')}>
                <Switch
                  checked={s.reminderSpeak}
                  onChange={(reminderSpeak) => updateSoundSettings({ reminderSpeak })}
                  label={t('settings.device.remindersSpeak')}
                />
              </Row>
            </>
          )}
        </div>
      </Group>
    </>
  );
}

/** The games corner on this device: on/off, play time per day, opening hours. */
function GamesGroup() {
  const g = useGamesSettings();
  return (
    <Group title={t('settings.device.gamesTitle')} note={g.enabled ? t('settings.device.gamesNote') : undefined}>
      <div className="set-card">
        <Row label={t('settings.device.games')} hint={t('settings.device.gamesHint')}>
          <Switch checked={g.enabled} onChange={(enabled) => updateGamesSettings({ enabled })} label={t('settings.device.games')} />
        </Row>
        {g.enabled && (
          <>
            <Row label={t('settings.device.gamesMinutes')} hint={t('settings.device.gamesMinutesHint')}>
              <Stepper
                value={g.dailyMinutes}
                min={0}
                max={240}
                unit={t('common.minutesShort')}
                onChange={(dailyMinutes) => updateGamesSettings({ dailyMinutes })}
              />
            </Row>
            <Row label={t('settings.device.gamesFrom')}>
              <Stepper
                value={g.from}
                min={0}
                max={23}
                unit={t('settings.device.oClock')}
                onChange={(from) => updateGamesSettings({ from })}
              />
            </Row>
            <Row label={t('settings.device.gamesTo')} hint={t('settings.device.gamesHoursHint')}>
              <Stepper value={g.to} min={1} max={24} unit={t('settings.device.oClock')} onChange={(to) => updateGamesSettings({ to })} />
            </Row>
          </>
        )}
      </div>
    </Group>
  );
}
