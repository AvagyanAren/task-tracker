import { useEffect, useRef, useState } from 'react';
import { registerConfirmHost, type ConfirmRequest } from '../confirm.js';
import { Trash } from '../icons.js';
import { useFocusTrap } from '../ui.js';

/** Mount once: renders the confirmation modal requested via confirmDialog(). */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(boxRef, req !== null);

  useEffect(() => {
    registerConfirmHost(setReq);
    return () => registerConfirmHost(null);
  }, []);

  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };

  useEffect(() => {
    if (!req) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!req) return null;
  return (
    <div className="overlay confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div ref={boxRef} className="dialog confirm" role="alertdialog" aria-modal="true" aria-label={req.title}>
        {req.danger && (
          <span className="confirm-icon">
            <Trash size={20} />
          </span>
        )}
        <h2>{req.title}</h2>
        {req.text && <p>{req.text}</p>}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={() => close(false)}>
            Отмена
          </button>
          <button ref={okRef} className={req.danger ? 'btn danger-solid' : 'btn primary'} onClick={() => close(true)}>
            {req.confirmLabel ?? 'Подтвердить'}
          </button>
        </div>
      </div>
    </div>
  );
}
