export interface Project {
  id: string;
  name: string;
  /** Price of one hour in `currency`. */
  rate: number;
  currency: string;
  color: string;
  archived: boolean;
  createdAt: string;
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
}

export interface State {
  projects: Project[];
  entries: Entry[];
}
