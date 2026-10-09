// @vitest-environment jsdom
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import App from './App.js';

let server: Server;
let store: Store;

beforeAll(async () => {
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ui-a11y-')), 'tracker.json'));
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => real(url.startsWith('/') ? base + url : url, init));
  window.confirm = () => true;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  location.hash = '';
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

configure({ asyncUtilTimeout: 4000 });

/** Every control a person can reach must have a name a screen reader can say. */
function unnamed(root: HTMLElement): string[] {
  const bad: string[] = [];
  root.querySelectorAll<HTMLElement>('button, [role=button], [role=tab], [role=menuitem]').forEach((el) => {
    const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() || el.getAttribute('title') || '';
    if (!name) bad.push(el.outerHTML.slice(0, 120));
  });
  root.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([type=file]), textarea, select').forEach((el) => {
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label') || (el.id && root.querySelector('label[for="' + el.id + '"]')) || el.placeholder;
    if (!labelled) bad.push(el.outerHTML.slice(0, 120));
  });
  return bad;
}

describe('доступность: у каждого элемента управления есть имя', () => {
  it('на всех экранах и в окнах', async () => {
    store.update((s) => {
      s.projects.push({ id: 'proj-x', name: 'Икс', rate: 10, currency: '$', color: '#2f6feb', archived: false, createdAt: new Date().toISOString() });
    });
    render(<App />);
    await screen.findByLabelText('Описание задачи');
    const problems: string[] = [];
    for (const tab of ['Таймер', 'Задачи', 'Отчёты', 'Счета', 'Проекты', 'Импорт']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + tab) }));
      await waitFor(() => expect(document.title).toContain(tab));
      problems.push(...unnamed(document.body).map((p) => tab + ': ' + p));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    const dlg = (await screen.findByRole('dialog')) as HTMLElement;
    for (const section of ['Основные', 'Таймер', 'Pomodoro', 'Уведомления', 'Профиль и счета', 'Данные']) {
      fireEvent.click(within(dlg).getByRole('tab', { name: section }));
      problems.push(...unnamed(dlg).map((p) => 'Настройки/' + section + ': ' + p));
    }
    expect(problems).toEqual([]);
  });
});

