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
let offline = false;

beforeAll(async () => {
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ui-')), 'tracker.json'));
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (offline ? Promise.reject(new TypeError('Failed to fetch')) : real(url.startsWith('/') ? base + url : url, init)));
  window.confirm = () => true;
});
afterEach(() => {
  cleanup();
  location.hash = '';
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const DESC = 'Описание задачи';

// The UI tests share a busy CPU with the other suites; give slow renders room.
configure({ asyncUtilTimeout: 4000 });

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
    click('Проект');
    fireEvent.click(await screen.findByRole('button', { name: 'SFIT' }));
    click(/Старт/);
    await screen.findByRole('button', { name: /Стоп/ });
    // интерфейс отвечает сразу, сервер догоняет
    await waitFor(() => expect(store.get().entries.filter((e) => e.end === null)).toHaveLength(1));
    click(/Стоп/);
    await screen.findByRole('button', { name: /Старт/ });
    await waitFor(() => expect(store.get().entries.filter((e) => e.end === null)).toHaveLength(0));
    const [timed] = store.get().entries;
    expect(timed).toMatchObject({ description: 'Мобильная версия', projectId });
    expect(timed.end).not.toBeNull();

    // 3. ручной режим: 10:00–12:30 сегодня = 2:30
    fireEvent.click(screen.getByRole('tab', { name: /вручную/i }));
    fireEvent.change(screen.getByLabelText(DESC), { target: { value: 'Платежи' } });
    // проект остаётся выбранным после прошлого запуска
    for (const [label, value] of [['Начало', '10:00'], ['Конец', '12:30']]) {
      const field = screen.getByLabelText(label);
      fireEvent.change(field, { target: { value } });
      fireEvent.blur(field);
    }
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

    // удаление: запись пропадает сразу, «Отменить» возвращает её
    const row2 = screen.getByText('Платежи v2').closest('.entry') as HTMLElement;
    fireEvent.click(within(row2).getByTitle('Удалить'));
    await waitFor(() => expect(screen.queryByText('Платежи v2')).toBeNull());
    expect(store.get().entries.some((e) => e.description === 'Платежи v2')).toBe(true); // на сервере пока есть
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить' }));
    await screen.findByText('Платежи v2');

    // без отмены запись удаляется на сервере через несколько секунд
    fireEvent.click(within(screen.getByText('Платежи v2').closest('.entry') as HTMLElement).getByTitle('Удалить'));
    await waitFor(() => expect(store.get().entries.some((e) => e.description === 'Платежи v2')).toBe(false), { timeout: 9000 });
  }, 20000);

  it('горячие клавиши: M открывает ручной режим, ? — справку, работают и на русской раскладке', async () => {
    render(<App />);
    await screen.findByLabelText(DESC);
    fireEvent.keyDown(window, { key: 'ь' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /вручную/i }).getAttribute('aria-selected')).toBe('true'));
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
    const dlg = await screen.findByRole('dialog', { name: /Новый счёт/ });
    // 2ч 30м × 25 = 62,50 в предпросмотре (русский по умолчанию)
    await waitFor(() => expect(within(dlg).getAllByText(/62,50/).length).toBeGreaterThan(0));
    expect(within(dlg).getAllByText('Счёт').length).toBeGreaterThan(0);
    fireEvent.click(within(dlg).getByRole('tab', { name: 'English' }));
    await waitFor(() => expect(within(dlg).getAllByText('Invoice').length).toBeGreaterThan(0));
    expect(within(dlg).getAllByText(/\$62\.50/).length).toBeGreaterThan(0);

    // сохранить как черновик → он появляется на вкладке «Счета» → отправлен → оплачен
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(store.get().invoices).toHaveLength(1));
    expect(store.get().invoices[0]).toMatchObject({ status: 'draft', total: 62.5, number: expect.stringMatching(/^INV-\d{4}-001$/) });
    expect(store.get().entries.filter((e) => e.invoiceId)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Счета' }));
    fireEvent.click(await screen.findByText(/INV-\d{4}-001/));
    const view = await screen.findByRole('dialog', { name: /Счёт INV/ });
    fireEvent.click(within(view).getByRole('button', { name: /Отметить отправленным/ }));
    fireEvent.click(await within(view).findByRole('button', { name: /Оплачен/ }));
    await waitFor(() => expect(store.get().invoices[0].status).toBe('paid'));
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

  it('доступность: фокус уходит в окно, не вылетает из него и возвращается после закрытия', async () => {
    render(<App />);
    const opener = (await screen.findByRole('button', { name: /Настройки/ })) as HTMLButtonElement;
    opener.focus();
    fireEvent.click(opener);
    const dlg = await screen.findByRole('dialog', { name: 'Настройки' });
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));

    // Shift+Tab с первого элемента переходит на последний, а не уходит под окно
    const focusables = dlg.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
    focusables[0].focus();
    fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true });
    expect(dlg.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Настройки' })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('без сети: старт и стоп сохраняются на устройстве и уходят на сервер, когда связь вернулась', async () => {
    render(<App />);
    await screen.findByLabelText(DESC);
    const startedAfter = Date.now();
    offline = true;
    fireEvent.change(screen.getByLabelText(DESC), { target: { value: 'Задача без сети' } });
    click(/Старт/);
    await screen.findByRole('button', { name: /Стоп/ }); // экран живёт, как будто связь есть
    await screen.findByText(/ждёт/);
    expect(store.get().entries.some((e) => e.description === 'Задача без сети')).toBe(false);

    click(/Стоп/); // стоп тоже ставится в очередь, порядок сохраняется
    await screen.findByRole('button', { name: /Старт/ });
    expect(JSON.parse(localStorage.getItem('tempo.queue.v1')!)).toHaveLength(2);

    offline = false;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(store.get().entries.find((e) => e.description === 'Задача без сети')?.end).toBeTruthy(), { timeout: 6000 });
    const saved = store.get().entries.find((e) => e.description === 'Задача без сети')!;
    expect(Date.parse(saved.start)).toBeGreaterThanOrEqual(startedAfter - 1000); // время нажатия, а не доставки
    expect(Date.parse(saved.start)).toBeLessThanOrEqual(Date.parse(saved.end!));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tempo.queue.v1') ?? '[]')).toHaveLength(0));
    expect(store.get().entries.filter((e) => e.description === 'Задача без сети')).toHaveLength(1);
  });

  it('таймшит: стрелки и Enter ходят по клеткам, Esc возвращает прежнее значение', async () => {
    render(<App />);
    await screen.findByLabelText(DESC);
    fireEvent.click(screen.getByRole('tab', { name: /Timesheet/ }));
    await screen.findByText('Итого за день');
    const cell = (r: number, c: number) => document.querySelector<HTMLInputElement>(`.ts-cell[data-r="${r}"][data-c="${c}"]`)!;
    expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(1);

    cell(0, 2).focus();
    fireEvent.keyDown(cell(0, 2), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cell(1, 2));
    fireEvent.keyDown(cell(1, 2), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(cell(0, 2));

    // влево/вправо уходят из клетки только на краю текста
    const c = cell(0, 2);
    c.value = '1:30';
    c.setSelectionRange(2, 2);
    fireEvent.keyDown(c, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(c);
    c.setSelectionRange(4, 4);
    fireEvent.keyDown(c, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cell(0, 3));

    // Esc отменяет набранное
    const d = cell(0, 3);
    const original = d.defaultValue;
    d.value = '9:99';
    fireEvent.keyDown(d, { key: 'Escape' });
    expect(d.value).toBe(original);
  });
});
