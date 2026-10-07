import { describe, expect, it } from 'vitest';
import { findTrigger, stripTrigger } from './mentions.js';

describe('@проект и #тег в описании', () => {
  it('триггер в конце слова', () => {
    expect(findTrigger('Сверстать @SF')).toEqual({ kind: '@', query: 'SF', at: 10 });
    expect(findTrigger('#')).toEqual({ kind: '#', query: '', at: 0 });
    expect(findTrigger('текст #ui')).toMatchObject({ kind: '#', query: 'ui' });
  });
  it('почта и середина текста — не триггер', () => {
    expect(findTrigger('a@b.com')).toBeNull();
    expect(findTrigger('@SF потом текст')).toBeNull();
    expect(findTrigger('без триггера')).toBeNull();
  });
  it('удаляет слово-триггер, оставляя текст', () => {
    const t = findTrigger('Сверстать @SF')!;
    expect(stripTrigger('Сверстать @SF', t)).toBe('Сверстать ');
  });
});
