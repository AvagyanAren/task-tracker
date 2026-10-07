import { useEffect, useRef } from 'react';

export interface Hotkeys {
  start: () => void;
  stop: () => void;
  manual: () => void;
  continueLast: () => void;
  help: () => void;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

/** Same letters as Toggl's web app; ignored while typing in a field. */
export function useHotkeys(enabled: boolean, handlers: Hotkeys) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('.dialog')) return;
      const h = ref.current;
      // Both Latin and Cyrillic layouts work.
      switch (e.key.toLowerCase()) {
        case 'n':
        case 'т':
          e.preventDefault();
          return h.start();
        case 's':
        case 'ы':
          e.preventDefault();
          return h.stop();
        case 'm':
        case 'ь':
          e.preventDefault();
          return h.manual();
        case 'c':
        case 'с':
          e.preventDefault();
          return h.continueLast();
        case '?':
          e.preventDefault();
          return h.help();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
