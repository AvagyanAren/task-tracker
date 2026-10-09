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
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ui-focus-')), 'tracker.json'));
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

describe('режим фокуса', () => {
  it('спокойный экран: время, остановка и закрытие; полноэкранная кнопка только там, где она работает', async () => {
    store.update((s) => {
      s.entries.push({ id: 'run-focus-1', description: 'Лендинг', projectId: null, tags: [], billable: true, start: new Date(Date.now() - 61_000).toISOString(), end: null, source: 'timer' });
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Режим фокуса' }));
    const dlg = (await screen.findByRole('dialog', { name: 'Режим фокуса' })) as HTMLElement;
    expect(within(dlg).getByRole('heading', { name: 'Лендинг' })).toBeTruthy();
    expect(within(dlg).getByText(/^0:01:0\d$/)).toBeTruthy();
    // в jsdom нет Fullscreen API, поэтому кнопки «на весь экран» быть не должно
    expect(within(dlg).queryByRole('button', { name: 'На весь экран' })).toBeNull();

    // с поддержкой Fullscreen API кнопка есть и просит весь экран
    cleanup();
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    const request = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = request;
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Режим фокуса' }));
    fireEvent.click(await screen.findByRole('button', { name: 'На весь экран' }));
    expect(request).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
    await waitFor(() => expect(store.get().entries.every((e) => e.end !== null)).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Режим фокуса' })).toBeNull());
  });
});

