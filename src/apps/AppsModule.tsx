import { useCallback, useEffect, useState } from 'react';
import {
  getApps,
  isDefaultLauncher,
  launchApp,
  onAppsChanged,
  openAndroidSettings,
  openAppInfo,
  uninstallApp,
  type InstalledApp,
} from '../native/launcher';
import { addAppTile } from '../lib/dashboard';
import { useTapOrLongPress } from '../lib/hooks';
import { GlyphIcon } from '../components/Icon';
import { Modal } from '../components/Modal';
import './apps.css';
import { t, locale } from '../i18n';

function AppTile({ app, onLaunch, onMenu }: { app: InstalledApp; onLaunch: () => void; onMenu: () => void }) {
  const press = useTapOrLongPress(onLaunch, onMenu);
  return (
    <button className="app-tile" {...press}>
      {app.icon ? (
        <img className="app-icon" src={app.icon} alt="" draggable={false} />
      ) : (
        <span className="app-icon app-icon-letter" aria-hidden>
          {app.label.slice(0, 1)}
        </span>
      )}
      <span className="app-label">{app.label}</span>
    </button>
  );
}

/**
 * Module "Apps" (only in the Android app): all installed apps to start, e.g. Netflix or Disney+.
 * The home button brings you back to HomeWally afterwards.
 */
export function AppsModule() {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [isHome, setIsHome] = useState(true);
  const [menuApp, setMenuApp] = useState<InstalledApp | null>(null);

  const load = useCallback(() => {
    getApps()
      .then((list) => {
        setApps(list);
        setError('');
      })
      .catch(() => setError(t('apps.loadFailed')));
    isDefaultLauncher()
      .then(setIsHome)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const off = onAppsChanged(load);
    // back from the Android settings (home app chosen?): check again
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(id);
  }, [notice]);

  const q = query.trim().toLocaleLowerCase(locale());
  const shown = (apps ?? []).filter((a) => !q || a.label.toLocaleLowerCase(locale()).includes(q));

  const addToDashboard = (app: InstalledApp) => {
    addAppTile(app);
    setMenuApp(null);
    setNotice(t('apps.addedToDashboard', { name: app.label }));
  };

  const showInfo = (app: InstalledApp) => {
    setMenuApp(null);
    openAppInfo(app.packageName).catch(() => setError(t('apps.infoFailed', { name: app.label })));
  };

  const uninstall = (app: InstalledApp) => {
    setMenuApp(null);
    uninstallApp(app.packageName).catch(() => setError(t('apps.uninstallFailed', { name: app.label })));
  };

  return (
    <div className="view apps-view">
      {!isHome && (
        <div className="apps-banner">
          <span>{t('apps.notHome')}</span>
          <button className="btn primary" onClick={() => openAndroidSettings('home')}>
            {t('apps.setHome')}
          </button>
        </div>
      )}
      <div className="apps-bar">
        <input
          type="search"
          value={query}
          placeholder={t('apps.search')}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="search"
        />
        <button className="btn apps-settings-btn" onClick={() => openAndroidSettings()}>
          <GlyphIcon glyph="⚙" name="gear" />
          <span>{t('apps.systemSettings')}</span>
        </button>
      </div>
      {notice && (
        <div className="apps-notice" role="status">
          {notice}
        </div>
      )}
      {error && <p className="empty">{error}</p>}
      {!error && apps === null && <div className="module-loading" aria-busy="true" />}
      {!error && apps !== null && shown.length === 0 && <p className="empty">{t('apps.none')}</p>}
      <div className="apps-grid">
        {shown.map((app) => (
          <AppTile
            key={`${app.packageName}/${app.activity}`}
            app={app}
            onLaunch={() => launchApp(app).catch(() => setError(t('apps.startFailed', { name: app.label })))}
            onMenu={() => setMenuApp(app)}
          />
        ))}
      </div>
      {menuApp && (
        <Modal onClose={() => setMenuApp(null)} label={menuApp.label}>
          <div className="modal app-menu">
            <div className="app-menu-head">
              {menuApp.icon ? (
                <img className="app-menu-icon" src={menuApp.icon} alt="" draggable={false} />
              ) : (
                <span className="app-menu-icon app-icon-letter" aria-hidden>
                  {menuApp.label.slice(0, 1)}
                </span>
              )}
              <div className="app-menu-meta">
                <h2>{menuApp.label}</h2>
                <span className="app-menu-pkg">{menuApp.packageName}</span>
              </div>
              <button className="icon-btn" onClick={() => setMenuApp(null)} aria-label={t('common.close')}>
                ✕
              </button>
            </div>
            <div className="app-menu-actions">
              <button className="btn" onClick={() => addToDashboard(menuApp)}>
                {t('apps.addToDashboard')}
              </button>
              <button className="btn" onClick={() => showInfo(menuApp)}>
                {t('apps.appInfo')}
              </button>
              {!menuApp.system && (
                <button className="btn danger" onClick={() => uninstall(menuApp)}>
                  {t('apps.uninstall')}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
