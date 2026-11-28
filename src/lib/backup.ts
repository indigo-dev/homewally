import type { AppConfig } from '../types';
import { parseConfig } from './config';
import { isRecord } from './persisted';
import { todos } from './todos';
import { localEvents } from './localEvents';
import { shopping } from './shopping';
import { soundSettings } from './sounds';
import { weatherSettings } from './weather';
import { dashboardLayout } from './dashboard';
import { frameSettings } from './frame';
import { gamesRecordsStore, gamesSettingsStore } from '../games/store';
import { moduleOrderStore } from '../components/ModuleNav';
import { getVoiceSettings, updateVoiceSettings } from '../voice/settings';
import { t } from '../i18n';

export interface BackupData {
  todos?: unknown;
  localEvents?: unknown;
  shopping?: unknown;
  weather?: unknown;
  dashboard?: unknown;
  frame?: unknown;
  games?: {
    settings?: unknown;
    records?: unknown;
  };
  sounds?: unknown;
  moduleOrder?: unknown;
  /** model and read-aloud preference only; the Gemini API key is never exported */
  voice?: {
    model?: unknown;
    speak?: unknown;
  };
}

export interface BackupPayload {
  config: AppConfig;
  data?: BackupData;
}

/** Builds a complete backup snapshot: config (family, calendars, timetables, school, settings) + all module data. */
export function buildBackup(cfg: AppConfig) {
  const voice = getVoiceSettings();
  return {
    ...cfg,
    data: {
      todos: todos.get(),
      localEvents: localEvents.get(),
      shopping: shopping.get(),
      weather: weatherSettings.get(),
      dashboard: dashboardLayout.get(),
      frame: frameSettings.get(),
      games: {
        settings: gamesSettingsStore.get(),
        records: gamesRecordsStore.get(),
      },
      sounds: soundSettings.get(),
      moduleOrder: moduleOrderStore.get(),
      voice: {
        model: voice.model,
        speak: voice.speak,
      },
    },
    exportedAt: new Date().toISOString(),
    app: 'family-calendar',
  };
}

/** Downloads the full backup as a JSON file. */
export function exportBackup(cfg: AppConfig): void {
  const payload = buildBackup(cfg);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `${t('settings.backup.fileName')}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Parses a backup object. Older config-only backups (without `data`) remain fully supported. */
export function parseBackup(raw: unknown): BackupPayload {
  const config = parseConfig(raw);
  if (!isRecord(raw) || !isRecord(raw.data)) return { config };
  const d = raw.data;
  const data: BackupData = {};
  if ('todos' in d) data.todos = d.todos;
  if ('localEvents' in d) data.localEvents = d.localEvents;
  if ('shopping' in d) data.shopping = d.shopping;
  if ('weather' in d) data.weather = d.weather;
  if ('dashboard' in d) data.dashboard = d.dashboard;
  if ('frame' in d) data.frame = d.frame;
  if (isRecord(d.games)) {
    data.games = {
      ...('settings' in d.games ? { settings: d.games.settings } : {}),
      ...('records' in d.games ? { records: d.games.records } : {}),
    };
  }
  if ('moduleOrder' in d) data.moduleOrder = d.moduleOrder;
  if ('sounds' in d) data.sounds = d.sounds;
  if (isRecord(d.voice)) {
    data.voice = {
      ...('model' in d.voice ? { model: d.voice.model } : {}),
      ...('speak' in d.voice ? { speak: d.voice.speak } : {}),
    };
  }
  return { config, data };
}

export async function readBackupFile(file: File): Promise<BackupPayload> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(t('config.noJson'));
  }
  return parseBackup(json);
}

/** Applies a parsed backup to the app config and every included module store. */
export function applyBackup(backup: BackupPayload, replaceConfig: (cfg: AppConfig) => void): void {
  replaceConfig(backup.config);
  const d = backup.data;
  if (!d) return;
  if ('todos' in d) todos.restore(d.todos);
  if ('localEvents' in d) localEvents.restore(d.localEvents);
  if ('shopping' in d) shopping.restore(d.shopping);
  if ('weather' in d) weatherSettings.restore(d.weather);
  if ('dashboard' in d) dashboardLayout.restore(d.dashboard);
  if ('frame' in d) frameSettings.restore(d.frame);
  if (d.games) {
    if ('settings' in d.games) gamesSettingsStore.restore(d.games.settings);
    if ('records' in d.games) gamesRecordsStore.restore(d.games.records);
  }
  if ('moduleOrder' in d) moduleOrderStore.restore(d.moduleOrder);
  if ('sounds' in d) soundSettings.restore(d.sounds);
  if (d.voice) {
    const patch: { model?: string; speak?: boolean } = {};
    if (typeof d.voice.model === 'string' && d.voice.model.trim()) patch.model = d.voice.model.trim();
    if (typeof d.voice.speak === 'boolean') patch.speak = d.voice.speak;
    if (Object.keys(patch).length > 0) updateVoiceSettings(patch);
  }
}
