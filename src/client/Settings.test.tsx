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
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ui-settings-')), 'tracker.json'));
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

describe('настройки по разделам', () => {
  it('разделы переключаются, профиль сохраняется на сервере, напоминание о таймере запоминается', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Настройки' }));
    const dlg = (await screen.findByRole('dialog')) as HTMLElement;
    // по умолчанию только раздел «Основные»
    expect(within(dlg).getByText('Склеивать одинаковые записи за день')).toBeTruthy();
    expect(within(dlg).queryByText('Цель на день')).toBeNull();

    fireEvent.click(within(dlg).getByRole('tab', { name: 'Pomodoro' }));
    expect(within(dlg).getByText('Цель на день')).toBeTruthy();
    expect(within(dlg).queryByText('Склеивать одинаковые записи за день')).toBeNull();

    fireEvent.click(within(dlg).getByRole('tab', { name: 'Таймер' }));
    fireEvent.change(within(dlg).getByLabelText('Напомнить, если таймер идёт дольше'), { target: { value: '6' } });
    fireEvent.blur(within(dlg).getByLabelText('Напомнить, если таймер идёт дольше'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tempo.settings.v1') ?? '{}').longTimerHours).toBe(6));

    fireEvent.click(within(dlg).getByRole('tab', { name: 'Профиль и счета' }));
    fireEvent.change(within(dlg).getByPlaceholderText('ИП Иванов / Tamchys Fit'), { target: { value: 'Витали' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(store.get().profile.sender.name).toBe('Витали'));
  });
});

