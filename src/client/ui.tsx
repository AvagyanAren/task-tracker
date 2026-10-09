import { useEffect, useRef, useState, type RefObject, type ReactNode } from 'react';
import { X } from './icons.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a modal: focus moves in when it opens, Tab and Shift+Tab wrap
 * around its controls, and focus goes back to whatever opened it when it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, active = true) {
  useEffect(() => {
    if (!active) return;
    const box = ref.current;
    if (!box) return;
    const opener = document.activeElement as HTMLElement | null;
    const items = () => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!box.contains(document.activeElement)) (items().find((el) => el.tagName !== 'BUTTON' || !el.getAttribute('aria-label')?.includes('Закрыть')) ?? box).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (list.length === 0) return e.preventDefault();
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    box.addEventListener('keydown', onKey);
    return () => {
      box.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [ref, active]);
}

export function Dialog({
  title,
  onClose,
  children,
  wide,
  className = ''
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(boxRef);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={boxRef} tabIndex={-1} className={`${wide ? 'dialog wide' : 'dialog'} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Closes when the user clicks outside or presses Escape. */
export function Popover({
  trigger,
  children,
  align = 'left'
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="popover-wrap" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && <div className={`popover ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          title={o.title}
          className={o.value === value ? 'seg-item active' : 'seg-item'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** One line of a settings list: title (+ optional hint) on the left, the control on the right. */
export function SettingRow({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="srow">
      <div className="srow-text">
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div className="srow-control">{children}</div>
    </div>
  );
}

/** Number input with a unit inside the field ("25 мин"). */
export function NumberField({
  label,
  ariaLabel,
  value,
  unit,
  min,
  max,
  onChange
}: {
  label?: string;
  ariaLabel?: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const field = (
    <span className="nfield">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label ?? ariaLabel}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
      {unit && <em>{unit}</em>}
    </span>
  );
  return label ? (
    <label className="field">
      <span>{label}</span>
      {field}
    </label>
  ) : (
    field
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="switch-row srow">
      <span className="srow-text">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function ProjectDot({ color, size = 10 }: { color?: string; size?: number }) {
  return <span className="dot" style={{ background: color ?? 'var(--text-3)', width: size, height: size }} />;
}
