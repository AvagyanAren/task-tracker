export interface Project {
  id: string;
  name: string;
  /** Price of one hour in `currency`. */
  rate: number;
  currency: string;
  color: string;
  archived: boolean;
  createdAt: string;
  /** Who is billed for this project; null = nobody yet. */
  clientId?: string | null;
}

export interface Party {
  name: string;
  address: string;
  email: string;
}

/** A person or company that gets invoices. */
export interface Client extends Party {
  id: string;
  /** Tax / registration number printed on the invoice. */
  taxId: string;
  currency: string;
  /** Default payment term for this client's invoices. */
  dueDays: number;
  notes: string;
  archived: boolean;
  createdAt: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid';

export interface InvoiceLineRecord {
  description: string;
  hours: number;
  rate: number;
  amount: number;
}

/**
 * A finished invoice. Everything printed on it is copied in (sender, client, lines),
 * so editing a client or a time entry later never changes a document already sent.
 * "Overdue" is not stored: it is a sent invoice whose due date has passed.
 */
export interface InvoiceRecord {
  id: string;
  number: string;
  status: InvoiceStatus;
  clientId: string | null;
  projectIds: string[];
  lang: 'ru' | 'en';
  currency: string;
  issueDate: string;
  dueDate: string;
  periodFrom: string;
  periodTo: string;
  sentAt: string | null;
  paidAt: string | null;
  sender: Party & { payment: string };
  client: Party & { taxId: string };
  lines: InvoiceLineRecord[];
  totalHours: number;
  subtotal: number;
  discountPct: number;
  discount: number;
  taxPct: number;
  tax: number;
  total: number;
  notes: string;
  /** Time entries covered by this invoice (they are marked with `invoiceId`). */
  entryIds: string[];
  createdAt: string;
}

/** The sender's own details and defaults, shared by every invoice. */
export interface Profile {
  sender: Party & { payment: string };
  lang: 'ru' | 'en';
  dueDays: number;
  notes: string;
}

/**
 * One tracked interval. A running timer is an entry with `end === null`
 * (at most one exists), so it survives restarts like any other entry.
 */
export interface Entry {
  id: string;
  description: string;
  projectId: string | null;
  tags: string[];
  /** Only billable time earns money in reports. */
  billable: boolean;
  /** ISO instants (UTC). */
  start: string;
  end: string | null;
  source?: 'timer' | 'manual' | 'toggl';
  /** Stable key of an imported row, so re-importing never duplicates. */
  externalId?: string;
  /** Set when the entry has been put on an invoice. */
  invoiceId?: string | null;
  /** The task card this time was tracked for; the entry keeps the card's title as its description. */
  taskId?: string | null;
}

export type Priority = 'none' | 'low' | 'medium' | 'high';

export interface BoardColumn {
  id: string;
  name: string;
}

/**
 * A kanban board. The general board (`projectId: null`, id "general") always exists;
 * every project can have one board of its own.
 */
export interface Board {
  id: string;
  name: string;
  projectId: string | null;
  columns: BoardColumn[];
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskComment {
  id: string;
  text: string;
  at: string;
}

export interface Task {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  checklist: ChecklistItem[];
  /** `YYYY-MM-DD` or null. */
  dueDate: string | null;
  priority: Priority;
  tags: string[];
  projectId: string | null;
  comments: TaskComment[];
  /** Position inside its column (0 = top). */
  order: number;
  createdAt: string;
}

export interface State {
  projects: Project[];
  entries: Entry[];
  clients: Client[];
  invoices: InvoiceRecord[];
  profile: Profile;
  boards: Board[];
  tasks: Task[];
}
