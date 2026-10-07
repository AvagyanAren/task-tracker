import { useCallback, useState } from 'react';
import type { Lang } from '../shared/invoice.js';

export interface Party {
  name: string;
  address: string;
  email: string;
}

export interface InvoiceProfile {
  sender: Party & { payment: string };
  /** Client details per project id. */
  clients: Record<string, Party>;
  lang: Lang;
  dueDays: number;
  notes: string;
  /** Next free sequence number for INV-YYYY-NNN. */
  counter: number;
}

export const EMPTY_PARTY: Party = { name: '', address: '', email: '' };

const DEFAULT: InvoiceProfile = {
  sender: { ...EMPTY_PARTY, payment: '' },
  clients: {},
  lang: 'ru',
  dueDays: 14,
  notes: '',
  counter: 1
};

const KEY = 'tempo.invoice.v1';

function read(): InvoiceProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<InvoiceProfile>;
    return { ...DEFAULT, ...raw, sender: { ...DEFAULT.sender, ...(raw.sender ?? {}) }, clients: raw.clients ?? {} };
  } catch {
    return DEFAULT;
  }
}

/** Invoice details live in this browser only, next to the other settings. */
export function useInvoiceProfile(): [InvoiceProfile, (fn: (p: InvoiceProfile) => InvoiceProfile) => void] {
  const [profile, setProfile] = useState<InvoiceProfile>(read);
  const update = useCallback((fn: (p: InvoiceProfile) => InvoiceProfile) => {
    setProfile((p) => {
      const next = fn(p);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode: keep in memory */
      }
      return next;
    });
  }, []);
  return [profile, update];
}
