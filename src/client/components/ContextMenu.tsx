import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from '../icons.js';

export type MenuItem =
  | { kind?: 'item'; label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; checked?: boolean }
  | { kind: 'label'; label: string }
  | { kind: 'sep' };

/**
 * The app's own right-click menu. It opens where the pointer is, stays inside the window,
 * and closes on Esc, a click elsewhere, scrolling or resizing. Arrow keys move, Enter picks.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const buttons = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    buttons()[0]?.focus();
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = buttons();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
      if (e.key === 'Tab') e.preventDefault();
    };
    // A second right-click elsewhere replaces the menu (the caller reopens it), so just close here.
    const onCtx = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('contextmenu', onCtx, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="ctx" role="menu" style={{ left: pos.left, top: pos.top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.kind === 'sep' ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : it.kind === 'label' ? (
          <div key={i} className="ctx-label">
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            <span className="ctx-icon">{it.icon}</span>
            <span className="ctx-text">{it.label}</span>
            {it.checked && <Check size={14} className="ctx-check" />}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
