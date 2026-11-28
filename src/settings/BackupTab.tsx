import { useRef, useState } from 'react';
import { useStore } from '../store';
import { applyBackup, exportBackup, readBackupFile } from '../lib/backup';
import { hasDemoData, loadDemo, removeDemo, resetApp, useDemoSummary, type DemoSummary } from '../lib/demoData';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Group } from './controls';
import { t } from '../i18n';

/** what "remove demo data" deletes, one line per area */
function demoParts(s: DemoSummary): string[] {
  const parts = (['members', 'todos', 'shopping', 'places', 'photos'] as const)
    .filter((k) => s[k] > 0)
    .map((k) => t(`settings.backup.demoParts.${k}`, { n: s[k] }));
  if (s.settings) parts.push(t('settings.backup.demoParts.settings'));
  return parts;
}

export function BackupTab() {
  const { config, replaceConfig } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState<'demo' | 'reset' | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = useDemoSummary();
  const parts = demoParts(demo);

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const backup = await readBackupFile(f);
      const calendars = t('settings.backup.calendars', { n: backup.config.calendars.length });
      if (!confirm(t('settings.backup.confirmImport', { n: backup.config.members.length, calendars }))) return;
      applyBackup(backup, replaceConfig);
      setMsg({ ok: true, text: t('settings.backup.imported') });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onRemoveDemo = async () => {
    setBusy(true);
    try {
      await removeDemo();
      setMsg({ ok: true, text: t('settings.backup.demoRemoved') });
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  const onReset = async () => {
    setBusy(true);
    await resetApp();
    window.location.reload();
  };

  return (
    <div className="form narrow">
      <p>{t('settings.backup.intro')}</p>
      <p className="warn">{t('settings.backup.warn')}</p>
      <div className="row-actions">
        <button className="btn primary" onClick={() => exportBackup(config)}>
          {t('settings.backup.export')}
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          {t('settings.backup.import')}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
      </div>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}

      <Group title={t('settings.backup.demoTitle')} note={t('settings.backup.demoNote')}>
        {hasDemoData(demo) ? (
          <ul className="demo-parts">
            {parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('settings.backup.demoNone')}</p>
        )}
        <div className="row-actions">
          <button className="btn danger" disabled={!hasDemoData(demo)} onClick={() => setAsk('demo')}>
            {t('settings.backup.demoRemove')}
          </button>
          {demo.members === 0 && (
            <button
              className="btn ghost"
              onClick={() => {
                loadDemo();
                setMsg({ ok: true, text: t('settings.backup.demoLoaded') });
              }}
            >
              {t('settings.backup.demoLoad')}
            </button>
          )}
        </div>
      </Group>

      <Group title={t('settings.backup.resetTitle')} note={t('settings.backup.resetNote')}>
        <div className="row-actions">
          <button className="btn danger" onClick={() => setAsk('reset')}>
            {t('settings.backup.resetAll')}
          </button>
        </div>
      </Group>

      {ask === 'demo' && (
        <ConfirmDialog
          title={t('settings.backup.demoRemoveTitle')}
          confirmLabel={t('settings.backup.demoRemoveConfirm')}
          busy={busy}
          onConfirm={onRemoveDemo}
          onClose={() => setAsk(null)}
        >
          <ul className="demo-parts">
            {parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="muted">{t('settings.backup.demoNote')}</p>
        </ConfirmDialog>
      )}
      {ask === 'reset' && (
        <ConfirmDialog
          title={t('settings.backup.resetConfirmTitle')}
          confirmLabel={t('settings.backup.resetConfirm')}
          busy={busy}
          onConfirm={onReset}
          onClose={() => setAsk(null)}
        >
          <p>{t('settings.backup.confirmReset')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
