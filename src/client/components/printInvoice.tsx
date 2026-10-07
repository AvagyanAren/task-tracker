import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The print-only copy of an invoice lives directly under <body>, so the page prints as
 * one clean A4 document instead of the whole app (see `#print-root` in styles.css).
 */
export function PrintPortal({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'print-root';
    document.body.appendChild(el);
    setRoot(el);
    return () => {
      el.remove();
    };
  }, []);
  return root ? createPortal(children, root) : null;
}

/** Opens the print dialog with the invoice number as the default PDF file name. */
export function printAs(title: string) {
  const prev = document.title;
  document.title = title;
  const restore = () => {
    document.title = prev;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}
