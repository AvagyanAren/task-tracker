export interface IdleTracker {
  /** Epoch ms when the person stopped being active, if currently idle. */
  idleSince: number | null;
}

export interface IdlePrompt {
  idleStartMs: number;
  idleMs: number;
}

/**
 * The browser's IdleDetector reports "idle" only after the threshold has
 * already passed, so the real start of the idle period is `now - threshold`.
 * When the person comes back we know how long they were away.
 */
export function onUserState(
  tracker: IdleTracker,
  userState: 'active' | 'idle',
  now: number,
  thresholdMs: number
): { tracker: IdleTracker; prompt: IdlePrompt | null } {
  if (userState === 'idle') {
    return { tracker: { idleSince: tracker.idleSince ?? now - thresholdMs }, prompt: null };
  }
  if (tracker.idleSince === null) return { tracker, prompt: null };
  return {
    tracker: { idleSince: null },
    prompt: { idleStartMs: tracker.idleSince, idleMs: Math.max(0, now - tracker.idleSince) }
  };
}

/**
 * Whether the prompt applies to the running entry: the idle period must lie
 * inside it. If the timer was started after the person went idle there is
 * nothing to discard.
 */
export function promptApplies(prompt: IdlePrompt, entryStartMs: number, minIdleMs = 60_000): boolean {
  return prompt.idleStartMs > entryStartMs && prompt.idleMs >= minIdleMs;
}
