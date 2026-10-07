// @vitest-environment jsdom
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import App from './App.js';

let server: Server;
let store: Store;

beforeAll(async () => {
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ui-')), 'tracker.json'));
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => real(url.startsWith('/') ? base + url : url, init));
  window.confirm = () => true;
});
afterEach(cleanup);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const DESC = 'Описание задачи';

describe('интерфейс трекера (сквозной сценарий)', () => {
  it('проект → таймер → запись → ручное время → отчёт с деньгами', async () => {
    render(<App />);
    await screen.findByLabelText(DESC);

    // 1. проект со ставкой
    click('Проекты');
    fireEvent.change(screen.getByPlaceholderText('Название проекта'), { target: { value: 'SFIT' } });
    fireEvent.change(screen.getByPlaceholderText('Ставка за час'), { target: { value: '25' } });
    click(/Создать проект/);
    await screen.findByText('SFIT', { selector: 'strong' });
    expect(store.get().projects[0]).toMatchObject({ name: 'SFIT', rate: 25 });
    const projectId = store.get().projects[0].id;

    // 2. таймер с названием и проектом
    click('Таймер');
    fireEvent.change(await screen.findByLabelText(DESC), { target: { value: 'Мобильная версия' } });
    click('Без проекта');
    fireEvent.click(await screen.findByRole('button', { name: 'SFIT' }));
    click(/Старт/);
    await screen.findByRole('button', { name: /Стоп/ });
    expect(store.get().entries.filter((e) => e.end === null)).toHaveLength(1);
    click(/Стоп/);
    await screen.findByRole('button', { name: /Старт/ });
    const [timed] = store.get().entries;
    expect(timed).toMatchObject({ description: 'Мобильная версия', projectId });
    expect(timed.end).not.toBeNull();

    // 3. ручной режим: 10:00–12:30 сегодня = 2:30
    fireEvent.click(screen.getByRole('tab', { name: /Вручную/ }));
    fireEvent.change(screen.getByLabelText(DESC), { target: { value: 'Платежи' } });
    // проект остаётся выбранным после прошлого запуска
    fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Конец'), { target: { value: '12:30' } });
    click(/Добавить/);
    await waitFor(() => expect(store.get().entries).toHaveLength(2));
    const manual = store.get().entries.find((e) => e.description === 'Платежи')!;
    expect(Date.parse(manual.end!) - Date.parse(manual.start)).toBe(2.5 * 3600_000);
    expect(manual.projectId).toBe(projectId);

    // 4. отчёты за неделю: 2ч 30м × 25 = 62.5
    click('Отчёты');
    await screen.findByText('Всего времени');
    await waitFor(() => expect(screen.getAllByText(/62[,.]5/).length).toBeGreaterThan(0));
  });

  it('ошибка сервера показывается пользователю, а не глотается', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Проекты' }));
    fireEvent.change(await screen.findByPlaceholderText('Название проекта'), { target: { value: 'sfit' } });
    click(/Создать проект/);
    expect((await screen.findByRole('alert')).textContent).toMatch(/уже есть/);
  });

  it('правка и удаление записи', async () => {
    render(<App />);
    await screen.findByText('Платежи');
    const row = screen.getByText('Платежи').closest('.entry') as HTMLElement;
    fireEvent.click(within(row).getByTitle('Править'));
    const dlg = (await screen.findByRole('dialog')) as HTMLElement;
    fireEvent.change(within(dlg).getByPlaceholderText('Что делали'), { target: { value: 'Платежи v2' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Платежи v2');

    const row2 = screen.getByText('Платежи v2').closest('.entry') as HTMLElement;
    fireEvent.click(within(row2).getByTitle('Удалить'));
    await waitFor(() => expect(store.get().entries.some((e) => e.description === 'Платежи v2')).toBe(false));
  });

  it('горячие клавиши: M открывает ручной режим, ? — справку, работают и на русской раскладке', async () => {
    render(<App />);
    await screen.findByLabelText(DESC);
    fireEvent.keyDown(window, { key: 'ь' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /Вручную/ }).getAttribute('aria-selected')).toBe('true'));
    fireEvent.keyDown(window, { key: '?' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('инвойс: окно за период с позициями, итогом и переключением языка', async () => {
    // прошлый тест удалил ручную запись — создаём 2ч 30м заново
    const start = Date.now() - 4 * 3600_000;
    await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Платежи', projectId: store.get().projects[0].id, start: new Date(start).toISOString(), end: new Date(start + 2.5 * 3600_000).toISOString() })
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отчёты' }));
    await screen.findByText('Всего времени');
    fireEvent.click(screen.getByRole('button', { name: 'Всё время' }));
    fireEvent.click(screen.getByRole('button', { name: /Инвойс/ }));
    const dlg = await screen.findByRole('dialog', { name: /Инвойс/ });
    // 2ч 30м × 25 = 62,50 в предпросмотре (русский по умолчанию)
    await waitFor(() => expect(within(dlg).getAllByText(/62,50/).length).toBeGreaterThan(0));
    expect(within(dlg).getAllByText('Счёт').length).toBeGreaterThan(0);
    fireEvent.click(within(dlg).getByRole('tab', { name: 'English' }));
    await waitFor(() => expect(within(dlg).getAllByText('Invoice').length).toBeGreaterThan(0));
    expect(within(dlg).getAllByText(/\$62\.50/).length).toBeGreaterThan(0);
    expect(document.querySelector('#print-root .inv-paper')).not.toBeNull();
  });

  it('переключение видов: календарь и timesheet', async () => {
    render(<App />);
    await screen.findByLabelText(DESC);
    fireEvent.click(screen.getByRole('tab', { name: /Календарь/ }));
    await screen.findByText(/За неделю/);
    fireEvent.click(screen.getByRole('tab', { name: /Timesheet/ }));
    await screen.findByText('Итого за день');
  });
});
