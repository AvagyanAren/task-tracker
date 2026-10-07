import { describe, expect, it } from 'vitest';
import { resolveStartTime, addDays, dayKey, formatClock, formatHM, hoursDecimal, isoToLocalTime, localToIso, parseDuration } from './time.js';

describe('длительность', () => {
  it('формат', () => {
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00:00');
    expect(formatHM(19800)).toBe('5ч 30м');
    expect(formatHM(7200)).toBe('2ч');
    expect(formatHM(1800)).toBe('30м');
    expect(hoursDecimal(19800)).toBe(5.5);
  });

  it.each([
    ['2:30', 9000],
    ['2.5', 9000],
    ['2,5', 9000],
    ['1h 30m', 5400],
    ['2ч 15м', 8100],
    ['90m', 5400],
    ['90', 5400],
    ['8', 28800],
    ['1:02:03', 3723],
    ['45 мин', 2700],
    ['3 часа', 10800]
  ])('разбор «%s»', (input, seconds) => {
    expect(parseDuration(input)).toBe(seconds);
  });

  it.each(['', 'abc', '2:75', '-1'])('мусор «%s» отклоняется', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe('локальные дни', () => {
  it('день в часовом поясе +4 сдвигается через полночь UTC', () => {
    expect(dayKey('2026-09-17T21:00:00.000Z', 240)).toBe('2026-09-18');
    expect(dayKey('2026-09-17T21:00:00.000Z', 0)).toBe('2026-09-17');
  });

  it('локальное время <-> ISO', () => {
    const iso = localToIso('2026-09-18', '09:30', 240);
    expect(iso).toBe('2026-09-18T05:30:00.000Z');
    expect(isoToLocalTime(iso, 240)).toBe('09:30');
  });

  it('addDays через границу месяца и года', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('время старта бегущего таймера', () => {
  const now = Date.parse('2026-10-07T10:00:00.000Z'); // 14:00 по UTC+4
  it('время раньше «сейчас» — сегодня', () => {
    expect(resolveStartTime('13:40', now, 240)).toBe('2026-10-07T09:40:00.000Z');
  });
  it('время позже «сейчас» — вчера', () => {
    expect(resolveStartTime('23:30', now, 240)).toBe('2026-10-06T19:30:00.000Z');
  });
  it('мусор отклоняется', () => {
    expect(resolveStartTime('25:00', now, 240)).toBeNull();
    expect(resolveStartTime('abc', now, 240)).toBeNull();
  });
});
