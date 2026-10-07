import { describe, expect, it } from 'vitest';
import { formatDayRu, normalizeTime } from './components/fields.js';

describe('поля даты и времени', () => {
  it('нормализует ввод времени', () => {
    expect(normalizeTime('930')).toBe('09:30');
    expect(normalizeTime('9')).toBe('09:00');
    expect(normalizeTime('9.30')).toBe('09:30');
    expect(normalizeTime('14:5')).toBe('14:05');
    expect(normalizeTime('2460')).toBeNull();
    expect(normalizeTime('abc')).toBeNull();
  });
  it('показывает дату по-русски', () => {
    expect(formatDayRu('2026-10-05')).toBe('5 окт 2026');
    expect(formatDayRu('')).toBe('—');
  });
});
