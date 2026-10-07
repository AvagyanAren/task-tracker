export interface Trigger {
  kind: '@' | '#';
  query: string;
  /** Index in the text where the trigger character sits. */
  at: number;
}

/**
 * Toggl-style shortcuts inside the description: typing "@" opens the project
 * list, "#" the tag list. Only a trigger at the END of the text counts, and it
 * must start a word ("a@b" is not a mention).
 */
export function findTrigger(text: string): Trigger | null {
  const m = /(^|\s)([@#])([^\s@#]*)$/.exec(text);
  if (!m) return null;
  return { kind: m[2] as '@' | '#', query: m[3], at: m.index + m[1].length };
}

/** Removes the trigger word so the description keeps only real text. */
export function stripTrigger(text: string, t: Trigger): string {
  return text.slice(0, t.at).replace(/\s+$/, ' ');
}
