import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useGamesSettings } from './games/store';
import { useStore } from './store';
import { oneOf, persisted, usePersisted } from './lib/persisted';
import { useWakeLock } from './lib/hooks';
import { onMinute, useMinute } from './lib/clock';
import { MemberFilter, ModuleHeader } from './components/Header';
import { MODULES, ModuleNav, navIndex, type ModuleId } from './components/ModuleNav';
import { switchModule } from './lib/transition';
import type { SettingsTab } from './settings/SettingsPanel';
import type { FrameMode } from './frame/PhotoFrame';
import { useFrameSettings, usePhotos } from './lib/frame';
import { lazyNamed, preloadWhenIdle } from './lib/lazy';
import { Dashboard } from './dashboard/Dashboard';
import { GlyphIcon } from './components/Icon';
import { ErrorBoundary } from './components/ErrorBoundary';
import { VoiceButton } from './voice/VoiceButton';
import { EventReminders } from './components/EventReminders';
import { isNative, onAndroidBack, setSystemBars } from './native/launcher';
import { t, useLanguage } from './i18n';

/** the open module, per device */
const moduleStore = persisted<ModuleId>(
  'fc.module',
  (raw) =>
    oneOf(
      raw,
      MODULES.map((m) => m.id),
      'dashboard',
    ),
  { syncTabs: false },
);
const setModule = (id: ModuleId) => moduleStore.set(id);

// The dashboard is the start page and loads with the app; everything else is loaded on first use
// (and fetched in the background shortly after the start, see preloadWhenIdle).
const CalendarModule = lazyNamed(() => import('./CalendarModule'), 'CalendarModule');
const WeatherModule = lazyNamed(() => import('./weather/WeatherModule'), 'WeatherModule');
const TimetableModule = lazyNamed(() => import('./timetable/TimetableModule'), 'TimetableModule');
const TodoBoard = lazyNamed(() => import('./todos/TodoBoard'), 'TodoBoard');
const ShoppingModule = lazyNamed(() => import('./shopping/ShoppingModule'), 'ShoppingModule');
const FrameModule = lazyNamed(() => import('./frame/FrameModule'), 'FrameModule');
const PhotoFrame = lazyNamed(() => import('./frame/PhotoFrame'), 'PhotoFrame');
const SettingsPanel = lazyNamed(() => import('./settings/SettingsPanel'), 'SettingsPanel');
const AppsModule = lazyNamed(() => import('./apps/AppsModule'), 'AppsModule');
const GamesModule = lazyNamed(() => import('./games/GamesModule'), 'GamesModule');
const LAZY = [
  CalendarModule,
  WeatherModule,
  TimetableModule,
  TodoBoard,
  ShoppingModule,
  FrameModule,
  PhotoFrame,
  SettingsPanel,
  GamesModule,
  ...(isNative ? [AppsModule] : []),
];

export function App() {
  const { settings, members } = useStore();
  // re-render everything when the language changes (also with the 'auto' setting and a new device language)
  useLanguage();
  const module = usePersisted(moduleStore);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(members.length === 0);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>();
  const [reloadKey, setReloadKey] = useState(0);
  const [dashEditing, setDashEditing] = useState(false);
  const [mountedAt] = useState(Date.now);
  const lastInteraction = useRef(mountedAt);
  const frameCfg = useFrameSettings();
  const photos = usePhotos();
  const [frame, setFrame] = useState<{ mode: FrameMode; startId?: string } | null>(null);
  // selected photos that still exist, in album order
  const frameIds = (photos ?? []).filter((p) => frameCfg.selected.includes(p.id)).map((p) => p.id);

  useWakeLock(settings.keepAwake);
  // the games corner or the school area was switched off while open: back to the overview
  const games = useGamesSettings();
  useEffect(() => {
    if ((module === 'games' && !games.enabled) || (module === 'timetable' && !settings.schoolEnabled)) setModule('dashboard');
  }, [module, games.enabled, settings.schoolEnabled]);

  /** switches the area with the cross-fade (rail, widgets, voice, links) */
  const goModule = useCallback(
    (id: ModuleId) => {
      if (id === module) return;
      switchModule(
        () => {
          setModule(id);
          setDashEditing(false);
        },
        navIndex(id) >= navIndex(module) ? 1 : -1,
      );
    },
    [module],
  );
  useEffect(() => preloadWhenIdle(LAZY), []);

  // theme
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // style + resolved light/dark (the styles only need one dark selector: [data-mode='dark'])
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-style', settings.style);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'auto' && mq.matches);
      root.setAttribute('data-mode', dark ? 'dark' : 'light');
      setSystemBars(dark);
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      if (bg) {
        // replace all theme-color metas (incl. media-scoped ones from index.html) so Android PWAs
        // reliably repaint the status bar for the active style and light/dark choice
        document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.remove());
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = bg;
        document.head.appendChild(meta);
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.style, settings.theme]);

  // after inactivity go back to the dashboard (wall display mode)
  useEffect(() => {
    const mark = () => (lastInteraction.current = Date.now());
    window.addEventListener('pointerdown', mark, { passive: true });
    window.addEventListener('keydown', mark);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, []);
  // checked on every minute tick – without re-rendering the app
  useEffect(
    () =>
      onMinute(() => {
        if (!settings.idleResetMinutes || settingsOpen) return;
        if (Date.now() - lastInteraction.current < settings.idleResetMinutes * 60_000) return;
        setModule('dashboard');
        setDashEditing(false);
      }),
    [settings.idleResetMinutes, settingsOpen],
  );

  // screensaver: the photo frame after inactivity
  // (with a clock chosen it also runs without photos: then it is a big clock)
  const canFrame = frameIds.length > 0 || frameCfg.clockFace !== 'none';
  useEffect(
    () =>
      onMinute(() => {
        if (!frameCfg.screensaverMin || settingsOpen || frame || !canFrame) return;
        if (Date.now() - lastInteraction.current < frameCfg.screensaverMin * 60_000) return;
        setFrame({ mode: 'screensaver' });
      }),
    [frameCfg.screensaverMin, settingsOpen, frame, canFrame],
  );

  // Android back button (the launcher itself never closes): photo frame, then settings, then the overview
  useEffect(
    () =>
      onAndroidBack(() => {
        lastInteraction.current = Date.now();
        if (frame) setFrame(null);
        else if (settingsOpen) {
          setSettingsOpen(false);
          setReloadKey((n) => n + 1);
        } else if (dashEditing) setDashEditing(false);
        else goModule('dashboard');
      }),
    [frame, settingsOpen, dashEditing, goModule],
  );

  const openSettings = (tab?: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  return (
    <div className="shell" data-module={module}>
      <ModuleNav active={module} onSelect={goModule} />
      <div className="app">
        <ErrorBoundary label={MODULES.find((m) => m.id === module)?.label ?? t('app.module')} resetKey={module}>
          <Suspense fallback={<div className="module-loading" aria-busy="true" />}>
            {module === 'dashboard' && (
              <>
                <ModuleHeader
                  title={<Greeting />}
                  clock={false}
                  onSettings={() => openSettings()}
                  actions={
                    !dashEditing && (
                      <button
                        className="icon-btn"
                        onClick={() => setDashEditing(true)}
                        aria-label={t('app.editDashboard')}
                        title={t('common.edit')}
                      >
                        <GlyphIcon glyph="✎" name="edit" />
                      </button>
                    )
                  }
                />
                <Dashboard
                  reloadKey={reloadKey}
                  editing={dashEditing}
                  onEditing={setDashEditing}
                  openModule={goModule}
                  startFrame={(startId) => setFrame({ mode: 'manual', startId })}
                  // nothing to show yet (no photos, no clock face): open the photo frame to set it up
                  startScreensaver={() => (canFrame ? setFrame({ mode: 'screensaver' }) : goModule('frame'))}
                  openSettings={openSettings}
                />
              </>
            )}
            {module === 'calendar' && (
              <CalendarModule
                reloadKey={reloadKey}
                settingsOpen={settingsOpen}
                onSettings={() => openSettings()}
                onWeather={() => goModule('weather')}
              />
            )}
            {module === 'weather' && (
              <>
                <ModuleHeader title={t('titles.weather')} onSettings={() => openSettings()} />
                <WeatherModule />
              </>
            )}
            {module === 'timetable' && (
              <>
                <ModuleHeader title={t('titles.timetable')} onSettings={() => openSettings('school')} />
                <TimetableModule onSettings={() => openSettings('family')} />
              </>
            )}
            {module === 'todos' && (
              <>
                <ModuleHeader title={t('titles.todos')} onSettings={() => openSettings()} />
                <MemberFilter issues={{}} onIssue={() => {}} />
                <TodoBoard />
              </>
            )}
            {module === 'frame' && (
              <>
                <ModuleHeader title={t('titles.frame')} onSettings={() => openSettings()} />
                <FrameModule onStart={(startId) => setFrame({ mode: 'manual', startId })} />
              </>
            )}
            {module === 'shopping' && (
              <>
                <ModuleHeader title={t('titles.shopping')} onSettings={() => openSettings()} />
                <ShoppingModule />
              </>
            )}
            {module === 'apps' && isNative && (
              <>
                <ModuleHeader title={t('titles.apps')} onSettings={() => openSettings()} />
                <AppsModule />
              </>
            )}
            {module === 'games' && (
              <>
                <ModuleHeader title={t('titles.games')} onSettings={() => openSettings('device')} />
                <GamesModule />
              </>
            )}
          </Suspense>
        </ErrorBoundary>
      </div>
      <ErrorBoundary label={t('titles.voice')} fallback={null} retrySec={0}>
        <VoiceButton onOpenModule={goModule} onSettings={() => openSettings('voice')} />
      </ErrorBoundary>
      {frame && canFrame && (
        <ErrorBoundary label={t('titles.frame')} fallback={null} retrySec={0} onError={() => setFrame(null)}>
          <Suspense fallback={null}>
            <PhotoFrame
              ids={frameIds}
              mode={frame.mode}
              startId={frame.startId}
              onClose={() => {
                lastInteraction.current = Date.now();
                setFrame(null);
              }}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel
            initialTab={settingsTab}
            onClose={() => {
              setSettingsOpen(false);
              setReloadKey((n) => n + 1);
            }}
          />
        </Suspense>
      )}
      <EventReminders />
    </div>
  );
}

/** Greeting by time of day; its own component so only it follows the clock. */
function Greeting() {
  return <>{greeting(useMinute().getHours())}</>;
}

function greeting(h: number): string {
  if (h < 5) return t('app.greeting.night');
  if (h < 11) return t('app.greeting.morning');
  if (h < 18) return t('app.greeting.day');
  if (h < 22) return t('app.greeting.evening');
  return t('app.greeting.night');
}
