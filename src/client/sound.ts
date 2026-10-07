/**
 * Chime without any audio file. `gentle` is a soft rising arpeggio with a slow
 * attack and long fade; otherwise a short two-tone beep. Silent if audio is blocked.
 */
export function chime(gentle = false) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    if (gentle) {
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const at = ctx.currentTime + i * 0.35;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.14, at + 0.18);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
        o.connect(g).connect(ctx.destination);
        o.start(at);
        o.stop(at + 1.7);
      });
      setTimeout(() => void ctx.close(), 3200);
      return;
    }
    const tone = (freq: number, at: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.45);
    };
    tone(880, 0);
    tone(1175, 0.22);
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* no audio */
  }
}

export function systemNotify(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  } catch {
    /* ignore */
  }
}

export async function askNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}
