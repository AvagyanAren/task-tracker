import type { Board, State } from './types.js';

export const DEFAULT_COLUMNS = ['К выполнению', 'В работе', 'На проверке', 'Готово'];

/** The board that always exists, for tasks that belong to no particular project. */
export const generalBoard = (): Board => ({
  id: 'general',
  name: 'Общая',
  projectId: null,
  columns: DEFAULT_COLUMNS.map((name, i) => ({ id: `col${i + 1}`, name })),
  createdAt: '2026-01-01T00:00:00.000Z'
});

/** The parts of a State that are not projects or entries, empty. Handy for building a State by hand. */
export const blank = (): Pick<State, 'clients' | 'invoices' | 'profile' | 'boards' | 'tasks'> => ({
  clients: [],
  invoices: [],
  boards: [generalBoard()],
  tasks: [],
  profile: { sender: { name: '', address: '', email: '', payment: '' }, lang: 'ru', dueDays: 14, notes: '' }
});
