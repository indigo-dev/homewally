import { useState } from 'react';
import type { CalendarSource } from '../types';
import { useStore } from '../store';
import { linkHelp, newCalendar } from '../lib/config';
import { checkProxy, normalizeIcsUrl, proxyOf, testCalendarLink } from '../lib/events';
import { useLocalEvents } from '../lib/localEvents';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Group, Row, Switch } from './controls';
import { isNative } from '../native/launcher';
import { t } from '../i18n';

type TestState = { busy: true } | { busy: false; ok: true; text: string } | { busy: false; ok: false; text: string };

export function CalendarsTab() {
  const { calendars, settings, updateSettings } = useStore();
  const { events: locals, clear: clearLocals } = useLocalEvents();
  const [proxy, setProxy] = useState(settings.proxyUrl);
  const [proxyKey, setProxyKey] = useState(settings.proxyKey);
  const [proxyTest, setProxyTest] = useState<TestState | null>(null);
  const [askClearLocal, setAskClearLocal] = useState(false);

  const saveProxy = async () => {
    const url = proxy.trim().replace(/\/+$/, '');
    const key = proxyKey.trim();
    setProxy(url);
    setProxyKey(key);
    updateSettings({ proxyUrl: url, proxyKey: key });
    if (!url) return setProxyTest(null);
    setProxyTest({ busy: true });
    setProxyTest({ busy: false, ...(await checkProxy({ url, key })) });
  };

  return (
    <div className="form">
      <Group title={t('settings.calendars.localTitle')} note={t('settings.calendars.localNote')}>
        <Row label={t('settings.calendars.localEnable')} hint={t('settings.calendars.localEnableHint')}>
          <Switch
            checked={settings.localCalendarEnabled}
            onChange={(v) => updateSettings({ localCalendarEnabled: v })}
            label={t('settings.calendars.localEnable')}
          />
        </Row>
        <Row
          label={t('settings.calendars.localStored')}
          hint={locals.length > 0 ? t('settings.calendars.localCount', { n: locals.length }) : t('settings.calendars.localEmpty')}
        >
          <button className="btn danger" disabled={locals.length === 0} onClick={() => setAskClearLocal(true)}>
            {t('settings.calendars.localClear')}
          </button>
        </Row>
      </Group>

      {askClearLocal && (
        <ConfirmDialog
          title={t('settings.calendars.localClearTitle')}
          confirmLabel={t('settings.calendars.localClearConfirm')}
          onConfirm={() => {
            clearLocals();
            setAskClearLocal(false);
          }}
          onClose={() => setAskClearLocal(false)}
        >
          <p>{t('settings.calendars.localClearBody', { n: locals.length })}</p>
        </ConfirmDialog>
      )}

      {isNative ? (
        <p className="help">{t('settings.calendars.nativeNote')}</p>
      ) : (
        <div className="field">
          <span>{t('settings.calendars.proxy')}</span>
          <div className="copy-row">
            <input
              style={{ flex: 1, minHeight: 44, border: '1px solid var(--line-strong)', borderRadius: 10, padding: '0 12px' }}
              value={proxy}
              placeholder="https://homewally-ics-proxy.NAME.workers.dev"
              onChange={(e) => setProxy(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="btn primary" onClick={saveProxy} disabled={proxyTest?.busy}>
              {t('settings.calendars.saveTest')}
            </button>
          </div>
          <input
            className="proxy-key"
            style={{ minHeight: 44, border: '1px solid var(--line-strong)', borderRadius: 10, padding: '0 12px', marginTop: 8 }}
            type="password"
            value={proxyKey}
            placeholder={t('settings.calendars.keyPlaceholder')}
            aria-label={t('settings.calendars.keyLabel')}
            onChange={(e) => setProxyKey(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {proxyTest && !proxyTest.busy && <p className={proxyTest.ok ? 'success' : 'error'}>{proxyTest.text}</p>}
          {!settings.proxyUrl && <p className="help">{t('settings.calendars.noProxy')}</p>}
        </div>
      )}

      <p className="help">{t('settings.calendars.assignHelp')}</p>

      <div className="cal-account">
        <div className="cal-account-head">
          <strong>{t('settings.calendars.subscribed')}</strong>
        </div>
        {calendars.map((c) => (
          <CalendarRow key={c.id} cal={c} />
        ))}
        {calendars.length === 0 && <p className="muted cal-empty">{t('settings.calendars.empty')}</p>}
        <AddCalendar />
      </div>
    </div>
  );
}

function AddCalendar() {
  const { calendars, upsertCalendar, members, settings } = useStore();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState<TestState | null>(null);
  const [showHelp, setShowHelp] = useState(() => calendars.length === 0);

  const add = async (force = false) => {
    const link = url.trim();
    if (!/^(https?|webcals?):\/\//i.test(link)) {
      setAdding({ busy: false, ok: false, text: t('settings.calendars.fullLink') });
      return;
    }
    let calName = name.trim();
    if (!force) {
      setAdding({ busy: true });
      try {
        const res = await testCalendarLink(proxyOf(settings), link);
        calName ||= res.name ?? '';
      } catch (e) {
        setAdding({ busy: false, ok: false, text: e instanceof Error ? e.message : String(e) });
        return;
      }
    }
    // preselect nobody, but if exactly one person exists, assign it
    upsertCalendar(newCalendar(calName, link, members.length === 1 ? [members[0].id] : []));
    setName('');
    setUrl('');
    setAdding(null);
    setShowHelp(false);
  };

  return (
    <div className="add-box">
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <strong>{t('settings.calendars.add')}</strong>
        <button className="link" onClick={() => setShowHelp((v) => !v)}>
          {showHelp ? t('settings.calendars.hideHelp') : t('settings.calendars.whereLink')}
        </button>
      </div>
      {showHelp && (
        <dl className="help link-help">
          {linkHelp().map((h) => (
            <div key={h.label}>
              <dt>
                {h.icon} {h.label}
              </dt>
              <dd>{h.help}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="field-row">
        <label className="field">
          <span>{t('settings.calendars.nameOptional')}</span>
          <input value={name} placeholder={t('settings.calendars.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('settings.calendars.link')}</span>
          <input
            value={url}
            placeholder="https://…/basic.ics"
            onChange={(e) => setUrl(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      </div>
      <div className="row-actions">
        <button className="btn primary" disabled={!url.trim() || adding?.busy} onClick={() => add()}>
          {adding?.busy ? t('common.checking') : t('settings.calendars.checkAdd')}
        </button>
        {adding && !adding.busy && !adding.ok && (
          <>
            <span className="error">{adding.text}</span>
            {/^(https?|webcals?):\/\//i.test(url.trim()) && (
              <button className="btn" onClick={() => add(true)}>
                {t('settings.calendars.addAnyway')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(normalizeIcsUrl(url)).hostname;
  } catch {
    return t('settings.calendars.invalidLink');
  }
}

function CalendarRow({ cal }: { cal: CalendarSource }) {
  const { members, patchCalendar, removeCalendar, toggleCalendarMember, settings } = useStore();
  const [test, setTest] = useState<TestState | null>(null);

  const run = async () => {
    setTest({ busy: true });
    try {
      const res = await testCalendarLink(proxyOf(settings), cal.url);
      setTest({ busy: false, ok: true, text: t('settings.calendars.testOk', { n: res.upcoming }) });
    } catch (e) {
      setTest({ busy: false, ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const host = hostOf(cal.url);

  return (
    <div className={`cal-row ${cal.enabled ? '' : 'disabled'}`}>
      <input
        type="checkbox"
        checked={cal.enabled}
        onChange={(e) => patchCalendar(cal.id, { enabled: e.target.checked })}
        aria-label={t('settings.calendars.show')}
        style={{ width: 22, height: 22, accentColor: 'var(--accent)' }}
      />
      <div className="cal-name">
        <input
          value={cal.name}
          onChange={(e) => patchCalendar(cal.id, { name: e.target.value })}
          aria-label={t('settings.calendars.calName')}
        />
        <span className="cal-url" title={host}>
          {host}
        </span>
        <span className="row-actions">
          {cal.memberIds.length === 0 && <span className="badge warn">{t('settings.calendars.unassigned')}</span>}
          {test?.busy && <span className="badge">{t('settings.calendars.checkingSmall')}</span>}
          {test && !test.busy && <span className={`badge ${test.ok ? 'ok' : 'err'}`}>{test.text}</span>}
        </span>
      </div>
      <div className="assign" aria-label={t('settings.calendars.people')}>
        {members.map((m) => {
          const on = cal.memberIds.includes(m.id);
          return (
            <button
              key={m.id}
              className={`assign-btn ${on ? 'on' : ''}`}
              aria-pressed={on}
              title={on ? t('settings.calendars.unassign', { name: m.name }) : t('settings.calendars.assign', { name: m.name })}
              onClick={() => toggleCalendarMember(cal.id, m.id)}
            >
              <Avatar member={m} size={34} ring={on} />
            </button>
          );
        })}
        {members.length === 0 && <span className="muted small">{t('settings.calendars.noPeople')}</span>}
      </div>
      <div className="row-actions">
        <button className="btn" onClick={run} disabled={test?.busy}>
          {t('settings.calendars.test')}
        </button>
        <button
          className="btn danger"
          onClick={() => confirm(t('settings.calendars.confirmRemove', { name: cal.name })) && removeCalendar(cal.id)}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
