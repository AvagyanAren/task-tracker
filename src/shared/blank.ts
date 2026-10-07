import type { State } from './types.js';

/** The parts of a State that are not projects or entries, empty. Handy for building a State by hand. */
export const blank = (): Pick<State, 'clients' | 'invoices' | 'profile'> => ({
  clients: [],
  invoices: [],
  profile: { sender: { name: '', address: '', email: '', payment: '' }, lang: 'ru', dueDays: 14, notes: '' }
});
