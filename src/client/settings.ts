import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_POMODORO, type PomodoroSettings } from '../shared/pomodoro.js';
import { DEFAULT_AMBIENT, type AmbientSettings } from './ambient.js';

export type Theme = 'auto' | 'light' | 'dark';
export type TimerView = 'list' | 'calendar' | 'timesheet';

export interface Settings {
  theme: Theme;
  hotkeys: boolean;
  groupSimilar: boolean;
  idleEnabled: boolean;
  idleMinutes: number;
  pomodoro: PomodoroSettings;
  view: TimerView;
  ambient: AmbientSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  hotkeys: true,
  groupSimilar: true,
  idleEnabled: false,
  idleMinutes: 5,
  pomodoro: DEFAULT_POMODORO,
  view: 'list',
  ambient: DEFAULT_AMBIENT
};

const KEY = 'tempo.settings.v1';

export function readSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw, pomodoro: { ...DEFAULT_POMODORO, ...(raw.pomodoro ?? {}) }, ambient: { ...DEFAULT_AMBIENT, ...(raw.ambient ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(readSettings);

  const patch = useCallback((p: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...p };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode: keep in memory */
      }
      return next;
    });
  }, []);

  // Theme is a CSS attribute on <html>; "auto" removes it so the OS setting applies.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  return [settings, patch];
}
