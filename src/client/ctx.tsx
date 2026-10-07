import { createContext, useContext } from 'react';
import type { State } from '../shared/types.js';
import type { Settings } from './settings.js';

export interface AppContext {
  state: State;
  now: number;
  /** Minutes east of UTC. */
  tz: number;
  settings: Settings;
  setSettings: (p: Partial<Settings>) => void;
  /** Runs an API call that returns the new state; errors become a toast. */
  run: (fn: () => Promise<State>) => Promise<boolean>;
  setState: (s: State) => void;
  fail: (message: string) => void;
  notify: (message: string) => void;
}

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppContext is missing');
  return v;
}
