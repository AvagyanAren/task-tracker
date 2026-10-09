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
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ui-tasks-')), 'tracker.json'));
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

describe('задачи (канбан)', () => {
  it('карточка → таймер из карточки → перенос в «Готово» не трогает таймер → история помнит задачу', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Задачи' }));

    // четыре колонки по умолчанию
    for (const name of ['К выполнению', 'В работе', 'На проверке', 'Готово']) expect(await screen.findByRole('listitem', { name })).toBeTruthy();

    // быстрое добавление карточки
    const todo = screen.getByRole('listitem', { name: 'К выполнению' });
    fireEvent.click(within(todo).getByRole('button', { name: /Добавить карточку/ }));
    fireEvent.change(within(todo).getByLabelText('Название новой задачи'), { target: { value: 'Сверстать доску' } });
    fireEvent.click(within(todo).getByRole('button', { name: 'Добавить' }));
    await within(todo).findByText('Сверстать доску');
    await waitFor(() => expect(store.get().tasks).toHaveLength(1));
    const task = store.get().tasks[0];

    // ▶ на карточке запускает общий таймер с названием карточки
    fireEvent.click(within(todo).getByRole('button', { name: 'Запустить таймер' }));
    await waitFor(() => expect(store.get().entries.filter((e) => e.end === null)).toHaveLength(1));
    expect(store.get().entries[0]).toMatchObject({ description: 'Сверстать доску', taskId: task.id });

    // перетаскивание в «Готово»: карточка переезжает, таймер продолжает идти
    const card = within(todo).getByRole('button', { name: 'Задача: Сверстать доску' });
    const dataTransfer = { setData: () => undefined, effectAllowed: '' };
    fireEvent.dragStart(card, { dataTransfer });
    const done = screen.getByRole('listitem', { name: 'Готово' });
    fireEvent.dragOver(done, { dataTransfer });
    fireEvent.drop(done, { dataTransfer });
    await waitFor(() => expect(store.get().tasks[0].columnId).toBe(store.get().boards[0].columns[3].id));
    expect(store.get().entries[0].end).toBeNull();
    await within(screen.getByRole('listitem', { name: 'Готово' })).findByText('Сверстать доску');

    // правый клик: своё меню вместо браузерного
    const cardEl = screen.getByRole('button', { name: 'Задача: Сверстать доску' });
    expect(fireEvent.contextMenu(cardEl)).toBe(false); // событие отменено, меню браузера не откроется
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'В работе' }));
    await waitFor(() => expect(store.get().tasks[0].columnId).toBe(store.get().boards[0].columns[1].id));
    expect(screen.queryByRole('menu')).toBeNull();
    // то же меню открывается кнопкой «⋯» (на телефоне правого клика нет)
    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей' }));
    expect(await screen.findByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // и обратно в «Готово» тем же меню
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Задача: Сверстать доску' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Готово' }));
    await waitFor(() => expect(store.get().tasks[0].columnId).toBe(store.get().boards[0].columns[3].id));
    await within(screen.getByRole('listitem', { name: 'Готово' })).findByText('Сверстать доску');

    // карточка: поля сохраняются, остановка таймера из окна
    fireEvent.click(screen.getByRole('button', { name: 'Задача: Сверстать доску' }));
    const dlg = (await screen.findByRole('dialog')) as HTMLElement;
    fireEvent.change(within(dlg).getByLabelText('Новый пункт чек-листа'), { target: { value: 'Проверить на телефоне' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Добавить' }));
    fireEvent.change(within(dlg).getByLabelText('Новый комментарий'), { target: { value: 'Готово к показу' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(store.get().tasks[0].comments).toHaveLength(1));
    await waitFor(() => expect(store.get().tasks[0].checklist.map((i) => i.text)).toEqual(['Проверить на телефоне']));
    // детали как в Jira: номер, история, оценка
    expect(within(dlg).getByText(/#1$/, { selector: 'h2' })).toBeTruthy();
    const est = within(dlg).getByLabelText('Оценка времени');
    fireEvent.change(est, { target: { value: '2ч' } });
    fireEvent.blur(est);
    await waitFor(() => expect(store.get().tasks[0].estimate).toBe(7200));
    fireEvent.click(within(dlg).getByRole('tab', { name: 'История' }));
    await within(dlg).findByText(/Перенесена: К выполнению → Готово/);

    // история таймера показывает то же название
    fireEvent.click(screen.getByRole('button', { name: /^Таймер/ }));
    await screen.findByText('Сверстать доску', { selector: '.entry-desc' });
  });

  it('доска проекта: создаётся один раз, карточки получают проект', async () => {
    store.update((s) => {
      s.projects.push({ id: 'proj-a', name: 'Альфа', rate: 0, currency: '$', color: '#2f6feb', archived: false, createdAt: new Date().toISOString() });
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Задачи' }));
    fireEvent.click(await screen.findByRole('button', { name: /Доска проекта/ }));
    const dlg = (await screen.findByRole('dialog')) as HTMLElement;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать доску' }));
    await waitFor(() => expect(store.get().boards.some((b) => b.projectId === 'proj-a')).toBe(true));
    await screen.findByRole('tab', { name: 'Альфа', selected: true });

    const col = screen.getByRole('listitem', { name: 'К выполнению' });
    fireEvent.click(within(col).getByRole('button', { name: /Добавить карточку/ }));
    fireEvent.change(within(col).getByLabelText('Название новой задачи'), { target: { value: 'Задача альфы' } });
    fireEvent.click(within(col).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(store.get().tasks.find((t) => t.title === 'Задача альфы')?.projectId).toBe('proj-a'));
    // у проекта уже есть доска: кнопка создания отключена
    expect((screen.getByRole('button', { name: /Доска проекта/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
