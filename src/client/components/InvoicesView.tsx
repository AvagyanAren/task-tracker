import { useMemo, useState } from 'react';
import { presetRange } from '../../shared/report.js';
import { displayStatus, formatInvoiceDate, type InvoiceDisplayStatus } from '../../shared/invoice.js';
import { dayKey } from '../../shared/time.js';
import type { InvoiceRecord } from '../../shared/types.js';
import { confirmDialog } from '../confirm.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { formatMoney, formatMoneyMap } from '../format.js';
import { Check, Invoice, Plus, Printer, Trash } from '../icons.js';
import { Dialog, Empty } from '../ui.js';
import { InvoiceDialog, recordToDoc } from './InvoiceDialog.js';
import { InvoicePaper } from './InvoicePaper.js';
import { PrintPortal, printAs } from './printInvoice.js';

const STATUS: Record<InvoiceDisplayStatus, { label: string; cls: string }> = {
  draft: { label: 'Черновик', cls: 'st-draft' },
  sent: { label: 'Отправлен', cls: 'st-sent' },
  overdue: { label: 'Просрочен', cls: 'st-overdue' },
  paid: { label: 'Оплачен', cls: 'st-paid' }
};

export function StatusChip({ status }: { status: InvoiceDisplayStatus }) {
  return <span className={`status-chip ${STATUS[status].cls}`}>{STATUS[status].label}</span>;
}

function sumBy(list: InvoiceRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of list) out[v.currency] = Math.round(((out[v.currency] ?? 0) + v.total) * 100) / 100;
  return out;
}

/** One saved invoice: the paper, its status and what can be done with it. */
function InvoiceView({ inv, onClose }: { inv: InvoiceRecord; onClose: () => void }) {
  const { state, now, tz, run } = useApp();
  const today = dayKey(now, tz);
  const status = displayStatus(inv, today);
  const first = state.projects.find((p) => p.id === inv.projectIds[0]);
  const names = inv.projectIds.map((id) => state.projects.find((p) => p.id === id)?.name).filter(Boolean).join(', ');
  const doc = recordToDoc(inv, names, first?.color ?? '#111111');
  const set = (s: 'draft' | 'sent' | 'paid') => run(() => api.updateInvoice(inv.id, { status: s }));

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Удалить счёт ${inv.number}?`,
      text: 'Время из него снова можно будет выставить в другом счёте.',
      confirmLabel: 'Удалить',
      danger: true
    });
    if (ok && (await run(() => api.deleteInvoice(inv.id)))) onClose();
  };

  return (
    <Dialog title={`Счёт ${inv.number}`} onClose={onClose} wide className="invoice-dialog invoice-view">
      <div className="invoice-side">
        <div className="invoice-actions">
          <div className="row gap">
            <StatusChip status={status} />
            <span className="muted small">
              {inv.status === 'paid' && inv.paidAt
                ? `оплачен ${formatInvoiceDate(inv.paidAt.slice(0, 10), 'ru')}`
                : status === 'overdue'
                  ? `срок был ${formatInvoiceDate(inv.dueDate, 'ru')}`
                  : `оплатить до ${formatInvoiceDate(inv.dueDate, 'ru')}`}
            </span>
          </div>
          <div className="row gap wrap">
            {inv.status === 'draft' && (
              <button className="btn subtle" onClick={() => void set('sent')}>
                Отметить отправленным
              </button>
            )}
            {inv.status === 'sent' && (
              <button className="btn primary" onClick={() => void set('paid')}>
                <Check size={16} /> Оплачен
              </button>
            )}
            {inv.status !== 'draft' && (
              <button className="btn ghost" onClick={() => void set(inv.status === 'paid' ? 'sent' : 'draft')}>
                {inv.status === 'paid' ? 'Снять «оплачен»' : 'Вернуть в черновики'}
              </button>
            )}
            <button className="btn subtle" onClick={() => printAs(inv.number)}>
              <Printer size={16} /> PDF
            </button>
            <button className="btn icon ghost danger" aria-label="Удалить счёт" title="Удалить" onClick={() => void remove()}>
              <Trash size={16} />
            </button>
          </div>
        </div>
        <div className="invoice-preview">
          <div className="invoice-scale">
            <InvoicePaper doc={doc} />
          </div>
        </div>
      </div>
      <PrintPortal>
        <InvoicePaper doc={doc} />
      </PrintPortal>
    </Dialog>
  );
}

type Filter = 'all' | InvoiceDisplayStatus;

export function InvoicesView() {
  const { state, now, tz } = useApp();
  const today = dayKey(now, tz);
  const [filter, setFilter] = useState<Filter>('all');
  const [opened, setOpened] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () => [...state.invoices].sort((a, b) => (a.issueDate === b.issueDate ? (a.number < b.number ? 1 : -1) : a.issueDate < b.issueDate ? 1 : -1)).map((v) => ({ v, status: displayStatus(v, today) })),
    [state.invoices, today]
  );
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, draft: 0, sent: 0, overdue: 0, paid: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const waiting = sumBy(rows.filter((r) => r.status === 'sent' || r.status === 'overdue').map((r) => r.v));
  const overdue = sumBy(rows.filter((r) => r.status === 'overdue').map((r) => r.v));
  const monthStart = presetRange('month', now, tz).fromDay;
  const paidMonth = sumBy(rows.filter((r) => r.status === 'paid' && (r.v.paidAt ?? '').slice(0, 10) >= monthStart).map((r) => r.v));

  const shown = rows.filter((r) => filter === 'all' || r.status === filter);
  const period = presetRange('lastMonth', now, tz);
  const open = state.invoices.find((v) => v.id === opened) ?? null;
  const clientName = (v: InvoiceRecord) => v.client.name || state.clients.find((c) => c.id === v.clientId)?.name || '—';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Счета</h1>
          <p className="muted">Выставленные счета, кто должен и что уже оплачено.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Новый счёт
        </button>
      </header>

      <section className="stats">
        <div className="stat">
          <span className="stat-label">Ждёт оплаты</span>
          <span className="stat-value">{formatMoneyMap(waiting)}</span>
          <span className="muted small">{counts.sent + counts.overdue} счетов</span>
        </div>
        <div className={Object.keys(overdue).length ? 'stat stat-alert' : 'stat'}>
          <span className="stat-label">Просрочено</span>
          <span className="stat-value">{formatMoneyMap(overdue)}</span>
          <span className="muted small">{counts.overdue ? `${counts.overdue} счетов` : 'всё в срок'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Оплачено в этом месяце</span>
          <span className="stat-value">{formatMoneyMap(paidMonth)}</span>
          <span className="muted small">{counts.paid} оплаченных всего</span>
        </div>
      </section>

      {rows.length === 0 ? (
        <Empty icon={<Invoice size={28} />} title="Счетов пока нет">
          Выберите клиента и период, а время, ставки и итоги Tempo подставит сам.
        </Empty>
      ) : (
        <>
          <div className="chips-row">
            {(['all', 'draft', 'sent', 'overdue', 'paid'] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? 'chip active' : 'chip'} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Все' : STATUS[f].label} <span className="chip-count">{counts[f]}</span>
              </button>
            ))}
          </div>
          <section className="panel flush">
            <table className="table inv-list">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Клиент</th>
                  <th>Выставлен</th>
                  <th>Оплатить до</th>
                  <th className="num">Сумма</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ v, status }) => (
                  <tr key={v.id} className="clickable" tabIndex={0} onClick={() => setOpened(v.id)} onKeyDown={(e) => e.key === 'Enter' && setOpened(v.id)}>
                    <td>
                      <strong>{v.number}</strong>
                    </td>
                    <td>{clientName(v)}</td>
                    <td>{formatInvoiceDate(v.issueDate, 'ru')}</td>
                    <td className={status === 'overdue' ? 'overdue-text' : ''}>{formatInvoiceDate(v.dueDate, 'ru')}</td>
                    <td className="num">
                      <strong>{formatMoney(v.total, v.currency)}</strong>
                    </td>
                    <td>
                      <StatusChip status={status} />
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted" style={{ textAlign: 'center' }}>
                      Нет счетов с таким статусом.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}

      {open && <InvoiceView inv={open} onClose={() => setOpened(null)} />}
      {creating && <InvoiceDialog fromDay={period.fromDay} toDay={period.toDay} onClose={() => setCreating(false)} />}
    </div>
  );
}
