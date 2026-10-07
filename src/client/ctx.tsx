import { createContext, useContext } from 'react';
import type { State } from '../shared/types.js';
import type { Optimistic } from './optimistic.js';
import type { Settings } from './settings.js';

export interface AppContext {
  state: State;
  now: number;
  /** Minutes east of UTC. */
  tz: number;
  settings: Settings;
  setSettings: (p: Partial<Settings>) => void;
  /** Runs an API call that returns the new state; errors become a toast. */
  run: (fn: () => Promise<State>, optimistic?: Optimistic) => Promise<boolean>;
  /** Removes an entry at once and offers "Отменить" for a few seconds before it is deleted for good. */
  deleteEntry: (id: string) => void;
  /** Start / stop / add time. These keep working without a connection and are sent when it returns. */
  startTimer: (description: string, projectId: string | null, tags: string[], billable: boolean) => Promise<boolean>;
  stopTimer: () => Promise<boolean>;
  addEntry: (e: { description: string; projectId: string | null; tags: string[]; billable: boolean; start: string; end: string }) => Promise<boolean>;
  /** Throws away a just-started accidental timer, even one that has not reached the server yet. */
  discardEntry: (id: string) => Promise<boolean>;
  /** Actions saved on this device and not yet sent. */
  pending: number;
  setState: (s: State) => void;
  fail: (message: string) => void;
  notify: (message: string) => void;
  /** True when the server asks for a password (online version). */
  authRequired: boolean;
  logout: () => void;
}

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppContext is missing');
  return v;
}
