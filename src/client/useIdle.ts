import { useEffect, useRef, useState } from 'react';
import { onUserState, promptApplies, type IdlePrompt, type IdleTracker } from '../shared/idle.js';

/** Minimal typing for the Idle Detection API (Chromium: Chrome, Edge). */
interface IdleDetectorLike extends EventTarget {
  userState: 'active' | 'idle' | null;
  start(options: { threshold: number; signal?: AbortSignal }): Promise<void>;
}
interface IdleDetectorCtor {
  new (): IdleDetectorLike;
  requestPermission(): Promise<'granted' | 'denied'>;
}

const ctor = (): IdleDetectorCtor | undefined => (window as unknown as { IdleDetector?: IdleDetectorCtor }).IdleDetector;

export const idleSupported = () => Boolean(ctor());

export async function requestIdlePermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  const C = ctor();
  if (!C) return 'unsupported';
  try {
    return await C.requestPermission();
  } catch {
    return 'denied';
  }
}

async function permissionGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'idle-detection' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

export interface IdleInfo extends IdlePrompt {
  entryId: string;
}

/**
 * System-wide idle detection through the browser. Shows a prompt only when a
 * timer was running while the person was away.
 */
export function useIdle(opts: {
  enabled: boolean;
  minutes: number;
  running: { id: string; start: string } | undefined;
  onPrompt: (info: IdleInfo) => void;
}) {
  const [active, setActive] = useState(false);
  const runningRef = useRef(opts.running);
  runningRef.current = opts.running;
  const promptRef = useRef(opts.onPrompt);
  promptRef.current = opts.onPrompt;

  useEffect(() => {
    const C = ctor();
    if (!opts.enabled || !C) {
      setActive(false);
      return;
    }
    const abort = new AbortController();
    let tracker: IdleTracker = { idleSince: null };
    const threshold = Math.max(60_000, opts.minutes * 60_000);

    void (async () => {
      if (!(await permissionGranted())) return;
      try {
        const detector = new C();
        detector.addEventListener('change', () => {
          const state = detector.userState === 'idle' ? 'idle' : 'active';
          const out = onUserState(tracker, state, Date.now(), threshold);
          tracker = out.tracker;
          const run = runningRef.current;
          if (out.prompt && run && promptApplies(out.prompt, Date.parse(run.start))) {
            promptRef.current({ ...out.prompt, entryId: run.id });
          }
        });
        await detector.start({ threshold, signal: abort.signal });
        setActive(true);
      } catch {
        setActive(false);
      }
    })();

    return () => abort.abort();
  }, [opts.enabled, opts.minutes]);

  return active;
}
