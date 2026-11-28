import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { locale } from '../i18n';

/**
 * Bridge to the Android shell (HomeWally, see android/ and capacitor.config.ts).
 * On the website everything here is inactive: `isNative` is false and the module "Apps" is hidden.
 */
export const isNative = Capacitor.isNativePlatform();

export interface InstalledApp {
  packageName: string;
  activity: string;
  label: string;
  /** PNG/WebP data URL; missing if Android had no icon */
  icon?: string;
  /** pre-installed system app (cannot be uninstalled directly) */
  system?: boolean;
}

export interface BatteryStatus {
  /** 0..100 */
  level: number;
  charging: boolean;
  full: boolean;
  /** estimated minutes until full (Android 9+, while charging) */
  chargeTimeMin?: number;
  /** battery temperature in °C */
  tempC?: number;
}

interface AppLauncherPlugin {
  getApps(opts?: { icons?: boolean }): Promise<{ apps: InstalledApp[] }>;
  getAppIcon(opts: { packageName: string; activity?: string }): Promise<{ icon: string; size: number }>;
  launch(opts: { packageName: string; activity?: string }): Promise<void>;
  openSettings(opts?: { page?: 'home' | 'app' }): Promise<void>;
  openAppInfo(opts: { packageName: string }): Promise<void>;
  uninstall(opts: { packageName: string }): Promise<void>;
  isDefaultLauncher(): Promise<{ value: boolean }>;
  setKeepAwake(opts: { enabled: boolean }): Promise<void>;
  setSystemBars(opts: { dark: boolean }): Promise<void>;
  getBattery(): Promise<BatteryStatus>;
  addListener(event: 'appsChanged', fn: () => void): Promise<PluginListenerHandle>;
  addListener(event: 'batteryChanged', fn: (status: BatteryStatus) => void): Promise<PluginListenerHandle>;
}

/** native part: android/app/src/main/java/io/github/indigodev/homewally/AppLauncherPlugin.java */
const AppLauncher = registerPlugin<AppLauncherPlugin>('AppLauncher');

export async function getApps(): Promise<InstalledApp[]> {
  if (!isNative) return [];
  const { apps } = await AppLauncher.getApps({ icons: true });
  return apps.sort((a, b) => a.label.localeCompare(b.label, locale(), { sensitivity: 'base' }));
}

const bigIcons = new Map<string, Promise<string>>();

/** An app's icon in the highest resolution it ships (up to 512 px), for the dashboard's app tiles. Kept in memory. */
export function getAppIcon(app: Pick<InstalledApp, 'packageName' | 'activity'>): Promise<string> {
  const key = `${app.packageName}/${app.activity}`;
  let p = bigIcons.get(key);
  if (!p) {
    p = AppLauncher.getAppIcon({ packageName: app.packageName, activity: app.activity }).then((r) => r.icon);
    p.catch(() => bigIcons.delete(key));
    bigIcons.set(key, p);
  }
  return p;
}

export const launchApp = (app: Pick<InstalledApp, 'packageName' | 'activity'>) =>
  AppLauncher.launch({ packageName: app.packageName, activity: app.activity });

export const openAndroidSettings = (page?: 'home' | 'app') => AppLauncher.openSettings({ page });

export const openAppInfo = (packageName: string) => AppLauncher.openAppInfo({ packageName });

export const uninstallApp = (packageName: string) => AppLauncher.uninstall({ packageName });

export async function isDefaultLauncher(): Promise<boolean> {
  if (!isNative) return false;
  return (await AppLauncher.isDefaultLauncher()).value;
}

export function setKeepAwake(enabled: boolean) {
  if (isNative) AppLauncher.setKeepAwake({ enabled }).catch(() => {});
}

export function setSystemBars(dark: boolean) {
  if (isNative) AppLauncher.setSystemBars({ dark }).catch(() => {});
}

/** Called when apps are installed or removed; returns the unsubscribe function. */
export function onAppsChanged(fn: () => void): () => void {
  if (!isNative) return () => {};
  const handle = AppLauncher.addListener('appsChanged', fn);
  return () => void handle.then((h) => h.remove());
}

export async function getBattery(): Promise<BatteryStatus | null> {
  if (!isNative) return null;
  try {
    return await AppLauncher.getBattery();
  } catch {
    return null;
  }
}

/** Called whenever the Android battery level or charging state changes. */
export function onBatteryChanged(fn: (status: BatteryStatus) => void): () => void {
  if (!isNative) return () => {};
  const handle = AppLauncher.addListener('batteryChanged', fn);
  return () => void handle.then((h) => h.remove());
}

/** The Android back button (MainActivity sends it to the web app instead of closing the launcher). */
export function onAndroidBack(fn: () => void): () => void {
  if (!isNative) return () => {};
  window.addEventListener('homewallyback', fn);
  return () => window.removeEventListener('homewallyback', fn);
}

/**
 * Loads a URL as text directly from the device, past the browser's CORS rules.
 * Only in the app: on the website calendar links still need the Cloudflare worker.
 */
export async function nativeGetText(url: string): Promise<{ status: number; text: string }> {
  const res = await CapacitorHttp.get({ url, responseType: 'text', headers: { Accept: 'text/calendar, text/plain, */*' } });
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  return { status: res.status, text };
}
