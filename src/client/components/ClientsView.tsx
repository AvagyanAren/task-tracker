import { useMemo, useState } from 'react';
import type { Client } from '../../shared/types.js';
import { displayStatus } from '../../shared/invoice.js';
import { dayKey } from '../../shared/time.js';
import { confirmDialog } from '../confirm.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { formatMoney } from '../format.js';
import { Archive, Pencil, Plus, Refresh, Trash, Wallet } from '../icons.js';
import { Dialog, Empty, NumberField } from '../ui.js';

type Draft = { name: string; email: string; address: string; taxId: string; currency: string; dueDays: number; notes: string };
const blankDraft = (dueDays: number): Draft => ({ name: '', email: '', address: '', taxId: '', currency: '$', dueDays, notes: '' });

function ClientDialog({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { state, run } = useApp();
  const [d, setD] = useState<Draft>(client ? { name: client.name, email: client.email, address: client.address, taxId: client.taxId, currency: client.currency, dueDays: client.dueDays, notes: client.notes } : blankDraft(state.profile.dueDays));
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const save = async () => {
    const ok = await run(() => (client ? api.updateClient(client.id, d) : api.createClient(d)));
    if (ok) onClose();
  };
  return (
    <Dialog title={client ? 'Клиент' : 'Новый клиент'} onClose={onClose}>
      <div className="form-stack">
        <label className="field">
          <span>Название или имя</span>
          <input autoFocus value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="ООО «Ромашка» / Иван Петров" />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Email</span>
            <input value={d.email} onChange={(e) => set({ email: e.target.value })} placeholder="billing@client.com" />
          </label>
          <label className="field">
            <span>ИНН / налоговый номер</span>
            <input value={d.taxId} onChange={(e) => set({ taxId: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>Адрес</span>
          <textarea rows={2} value={d.address} onChange={(e) => set({ address: e.target.value })} />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Валюта счетов</span>
            <input value={d.currency} onChange={(e) => set({ currency: e.target.value })} />
          </label>
          <div className="field">
            <span>Срок оплаты</span>
            <NumberField ariaLabel="Срок оплаты" value={d.dueDays} unit="дн." min={0} max={365} onChange={(dueDays) => set({ dueDays })} />
          </div>
        </div>
        <label className="field">
          <span>Заметки</span>
          <textarea rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Для себя: контакты, договорённости" />
        </label>
        <div className="row gap end">
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" disabled={!d.name.trim()} onClick={() => void save()}>
            Сохранить
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function ClientsView() {
  const { state, now, tz, run } = useApp();
  const [dialog, setDialog] = useState<Client | 'new' | null>(null);
  const today = dayKey(now, tz);

  const rows = useMemo(
    () =>
      state.clients.map((c) => {
        const projects = state.projects.filter((p) => p.clientId === c.id);
        const invoices = state.invoices.filter((v) => v.clientId === c.id);
        const owed = invoices.filter((v) => v.status === 'sent').reduce((n, v) => n + v.total, 0);
        const overdue = invoices.filter((v) => displayStatus(v, today) === 'overdue').reduce((n, v) => n + v.total, 0);
        const paid = invoices.filter((v) => v.status === 'paid').reduce((n, v) => n + v.total, 0);
        return { c, projects, invoices, owed, overdue, paid };
      }),
    [state, today]
  );

  return (
    <>
      <div className="row end">
        <button className="btn primary" onClick={() => setDialog('new')}>
          <Plus size={16} /> Новый клиент
        </button>
      </div>

      {rows.length === 0 ? (
        <Empty icon={<Wallet size={28} />} title="Клиентов пока нет">
          Привяжите к клиенту проекты, и счета заполнятся сами.
        </Empty>
      ) : (
        <section className="panel flush">
          <table className="table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Проекты</th>
                <th className="num">Ждёт оплаты</th>
                <th className="num">Оплачено</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, projects, invoices, owed, overdue, paid }) => (
                <tr key={c.id} className={c.archived ? 'archived' : ''}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.archived && <span className="badge" style={{ marginLeft: 8 }}>архив</span>}
                    {c.email && <div className="muted small">{c.email}</div>}
                  </td>
                  <td>
                    <span className="chips-inline">
                      {projects.length === 0 ? (
                        <span className="muted">нет</span>
                      ) : (
                        projects.map((p) => (
                          <span key={p.id} className="chip-lite">
                            <i className="dot" style={{ background: p.color, width: 8, height: 8 }} /> {p.name}
                          </span>
                        ))
                      )}
                    </span>
                  </td>
                  <td className="num">
                    {owed > 0 ? formatMoney(owed, c.currency) : <span className="muted">—</span>}
                    {overdue > 0 && <div className="small overdue-text">просрочено {formatMoney(overdue, c.currency)}</div>}
                  </td>
                  <td className="num">{paid > 0 ? formatMoney(paid, c.currency) : <span className="muted">—</span>}</td>
                  <td className="num nowrap">
                    <button className="btn icon ghost" aria-label={`Изменить ${c.name}`} title="Изменить" onClick={() => setDialog(c)}>
                      <Pencil size={16} />
                    </button>
                    <button className="btn icon ghost" aria-label={c.archived ? 'Вернуть' : 'В архив'} title={c.archived ? 'Вернуть из архива' : 'В архив'} onClick={() => void run(() => api.updateClient(c.id, { archived: !c.archived }))}>
                      {c.archived ? <Refresh size={16} /> : <Archive size={16} />}
                    </button>
                    {projects.length === 0 && invoices.length === 0 && (
                      <button
                        className="btn icon ghost"
                        aria-label={`Удалить ${c.name}`}
                        title="Удалить"
                        onClick={async () => (await confirmDialog({ title: `Удалить клиента «${c.name}»?`, confirmLabel: 'Удалить', danger: true })) && void run(() => api.deleteClient(c.id))}
                      >
                        <Trash size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {dialog && <ClientDialog client={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
