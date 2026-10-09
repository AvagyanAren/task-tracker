import { useMemo, useRef, useState } from 'react';
import { dayRangeToQuery, type ReportQuery } from '../../shared/report.js';
import {
  collectBillableLines,
  computeTotals,
  countInvoiced,
  lineAmount,
  nextInvoiceNumber,
  type Lang,
  type Rounding
} from '../../shared/invoice.js';
import type { InvoiceRecord, Party } from '../../shared/types.js';
import { addDays, dayKey } from '../../shared/time.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { Printer } from '../icons.js';
import { Dialog, NumberField, Segmented } from '../ui.js';
import { DateField, Select } from './fields.js';
import { InvoicePaper, type InvoiceDoc } from './InvoicePaper.js';
import { PrintPortal, printAs } from './printInvoice.js';

interface Props {
  /** Starting period; every filter other than the period is ignored (a client may have several projects). */
  query?: ReportQuery;
  fromDay: string;
  toDay: string;
  /** Pre-selected client (or `p:<projectId>` for a project without a client). */
  scope?: string;
  onClose: () => void;
}

type Sender = InvoiceRecord['sender'];
type ClientParty = InvoiceRecord['client'];
const EMPTY_SENDER: Sender = { name: '', address: '', email: '', payment: '' };

/** Details typed into the old per-browser invoice form, offered once so nothing has to be retyped. */
function legacyProfile(): { sender?: Partial<Sender>; clients?: Record<string, Partial<Party>> } {
  try {
    return JSON.parse(localStorage.getItem('tempo.invoice.v1') ?? '{}');
  } catch {
    return {};
  }
}

const ROUNDING: Array<{ value: Rounding; label: string }> = [
  { value: 'none', label: 'Без округления' },
  { value: '15', label: 'Вверх до 15 минут' },
  { value: '30', label: 'Вверх до 30 минут' },
  { value: '60', label: 'Вверх до часа' }
];

/** Invoice builder: choose client and period, adjust lines, preview the A4 page, save and print. */
export function InvoiceDialog({ fromDay: from0, toDay: to0, scope: scope0, onClose }: Props) {
  const { state, now, tz, setState, notify, fail } = useApp();
  const today = dayKey(now, tz);
  const legacy = useMemo(legacyProfile, []);

  const [fromDay, setFromDay] = useState(from0);
  const [toDay, setToDay] = useState(to0 < from0 ? from0 : to0);
  const [rounding, setRounding] = useState<Rounding>('none');
  const [again, setAgain] = useState(false);
  const query = useMemo(() => dayRangeToQuery(fromDay, toDay < fromDay ? fromDay : toDay, tz), [fromDay, toDay, tz]);

  // Who can be billed: every client with billable work in the period, plus loose projects with no client.
  const scopes = useMemo(() => {
    const withTime = collectBillableLines(state, query, state.projects.map((p) => p.id), now, 'none', false);
    const projectIds = new Set(withTime.map((l) => l.projectId));
    const out = new Map<string, { id: string; label: string; projectIds: string[] }>();
    for (const p of state.projects.filter((x) => projectIds.has(x.id))) {
      const client = p.clientId ? state.clients.find((c) => c.id === p.clientId) : undefined;
      const id = client ? client.id : `p:${p.id}`;
      const row = out.get(id) ?? { id, label: client ? client.name : `${p.name} (без клиента)`, projectIds: [] };
      row.projectIds.push(p.id);
      out.set(id, row);
    }
    return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [state, query, now]);

  const [scopeId, setScopeId] = useState(scope0 ?? '');
  const scope = scopes.find((s) => s.id === scopeId) ?? scopes[0];
  const client = scope && !scope.id.startsWith('p:') ? state.clients.find((c) => c.id === scope.id) : undefined;
  const first = scope ? state.projects.find((p) => p.id === scope.projectIds[0]) : undefined;

  const baseLines = useMemo(
    () => (scope ? collectBillableLines(state, query, scope.projectIds, now, rounding, !again) : []),
    [state, query, scope, now, rounding, again]
  );
  const skipped = scope ? countInvoiced(state, query, scope.projectIds) : 0;

  // Per-line edits survive changes of the period; they are keyed by project + task text.
  const [edits, setEdits] = useState<Record<string, { off?: boolean; description?: string; hours?: string; rate?: string }>>({});
  const setEdit = (key: string, patch: { off?: boolean; description?: string; hours?: string; rate?: string }) => setEdits((e) => ({ ...e, [key]: { ...e[key], ...patch } }));

  const lines = useMemo(
    () =>
      baseLines
        .filter((l) => !edits[l.key]?.off)
        .map((l) => {
          const e = edits[l.key] ?? {};
          const hours = e.hours !== undefined ? Number(e.hours.replace(',', '.')) || 0 : l.hours;
          const rate = e.rate !== undefined ? Number(e.rate.replace(',', '.')) || 0 : l.rate;
          return { key: l.key, entryIds: l.entryIds, projectId: l.projectId, description: e.description ?? l.description, hours, rate, amount: lineAmount(hours * 3600, rate).amount };
        }),
    [baseLines, edits]
  );

  const currencies = [...new Set(lines.map((l) => state.projects.find((p) => p.id === l.projectId)?.currency ?? ''))];
  const currency = currencies[0] ?? first?.currency ?? '$';
  const mixedCurrency = currencies.length > 1;

  const [discountPct, setDiscountPct] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const totals = computeTotals(lines, discountPct, taxPct);
  const totalHours = Math.round(lines.reduce((n, l) => n + l.hours, 0) * 100) / 100;

  const year = Number(today.slice(0, 4));
  const [numberText, setNumberText] = useState<string | null>(null);
  const number = numberText ?? nextInvoiceNumber(state.invoices.map((v) => v.number), year);
  const numberTaken = state.invoices.some((v) => v.number === number);

  const [issue, setIssue] = useState(today);
  const [dueDays, setDueDays] = useState<number | null>(null);
  const days = dueDays ?? client?.dueDays ?? state.profile.dueDays;
  const [lang, setLang] = useState<Lang>(state.profile.lang);
  const [notes, setNotes] = useState(state.profile.notes);

  const [sender, setSender] = useState<Sender>({ ...EMPTY_SENDER, ...(state.profile.sender.name ? state.profile.sender : { ...EMPTY_SENDER, ...(legacy.sender ?? {}) }) });
  const legacyClient = first ? legacy.clients?.[first.id] : undefined;
  const [partyEdit, setPartyEdit] = useState<Partial<ClientParty>>({});
  const party: ClientParty = {
    name: partyEdit.name ?? client?.name ?? legacyClient?.name ?? first?.name ?? '',
    address: partyEdit.address ?? client?.address ?? legacyClient?.address ?? '',
    email: partyEdit.email ?? client?.email ?? legacyClient?.email ?? '',
    taxId: partyEdit.taxId ?? client?.taxId ?? ''
  };

  const due = addDays(issue, days);
  const projectNames = scope ? scope.projectIds.map((id) => state.projects.find((p) => p.id === id)?.name ?? '').join(', ') : '';
  const doc: InvoiceDoc = {
    lang,
    number,
    issue,
    due,
    periodFrom: fromDay,
    periodTo: toDay < fromDay ? fromDay : toDay,
    projectName: projectNames,
    color: first?.color ?? '#111111',
    currency,
    sender,
    client: party,
    lines: lines.map((l) => ({ key: l.key, description: l.description, hours: l.hours, rate: l.rate, amount: l.amount })),
    totalHours,
    ...totals,
    discountPct,
    taxPct,
    notes
  };

  const [busy, setBusy] = useState(false);
  const saving = useRef(false); // blocks a second click before React has re-rendered
  const canSave = lines.length > 0 && !mixedCurrency && !numberTaken && !busy;

  const save = async (andPrint: boolean) => {
    if (!canSave || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const res = await api.createInvoice({
        clientId: client?.id ?? null,
        projectIds: scope!.projectIds,
        entryIds: lines.flatMap((l) => l.entryIds),
        number,
        lang,
        currency,
        issueDate: issue,
        dueDate: due,
        periodFrom: fromDay,
        periodTo: toDay < fromDay ? fromDay : toDay,
        sender,
        client: party,
        lines: lines.map((l) => ({ description: l.description, hours: l.hours, rate: l.rate })),
        discountPct,
        taxPct,
        notes
      });
      let next = res.state;
      // Details typed once are remembered for the next invoice.
      next = await api.saveProfile({ sender, lang, notes, dueDays: state.profile.dueDays });
      if (client) next = await api.updateClient(client.id, { email: party.email, address: party.address, taxId: party.taxId });
      setState(next);
      notify(andPrint ? 'Счёт сохранён. В окне печати выберите «Сохранить как PDF».' : 'Счёт сохранён как черновик');
      if (andPrint) printAs(number);
      onClose();
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  if (scopes.length === 0) {
    return (
      <Dialog title="Новый счёт" onClose={onClose}>
        <div className="form-stack">
          <p className="lead">В этом периоде нет оплачиваемого времени по проектам. Выберите другой период.</p>
          <div className="grid2">
            <label className="field">
              <span>С</span>
              <DateField value={fromDay} onChange={setFromDay} />
            </label>
            <label className="field">
              <span>По</span>
              <DateField value={toDay} onChange={setToDay} />
            </label>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Новый счёт" onClose={onClose} wide className="invoice-dialog">
      <div className="invoice-layout">
        <div className="invoice-form">
          <section>
            <h3>Кому и за что</h3>
            <div className="form-stack">
              <label className="field">
                <span>Клиент</span>
                <Select<string> value={scope?.id ?? ''} ariaLabel="Клиент" options={scopes.map((s) => ({ value: s.id, label: s.label }))} onChange={(id) => { setScopeId(id); setPartyEdit({}); setDueDays(null); }} />
              </label>
              <div className="grid2">
                <label className="field">
                  <span>С</span>
                  <DateField value={fromDay} onChange={setFromDay} ariaLabel="Начало периода" />
                </label>
                <label className="field">
                  <span>По (включительно)</span>
                  <DateField value={toDay} onChange={setToDay} ariaLabel="Конец периода" />
                </label>
              </div>
              <label className="field">
                <span>Округление времени</span>
                <Select<Rounding> value={rounding} ariaLabel="Округление" options={ROUNDING} onChange={setRounding} />
              </label>
              {skipped > 0 && (
                <label className="check">
                  <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
                  Показать и {skipped} уже выставленных записей
                </label>
              )}
            </div>
          </section>

          <section>
            <h3>Позиции</h3>
            {baseLines.length === 0 ? (
              <p className="hint">Всё время за период уже выставлено. Отметьте галочку выше, если нужно выставить ещё раз.</p>
            ) : (
              <div className="inv-items">
                {baseLines.map((l) => {
                  const e = edits[l.key] ?? {};
                  const off = Boolean(e.off);
                  const hours = e.hours !== undefined ? Number(e.hours.replace(',', '.')) || 0 : l.hours;
                  const rate = e.rate !== undefined ? Number(e.rate.replace(',', '.')) || 0 : l.rate;
                  return (
                    <div key={l.key} className={off ? 'inv-line off' : 'inv-line'}>
                      <input type="checkbox" checked={!off} aria-label="Включить в счёт" onChange={() => setEdit(l.key, { off: !off })} />
                      <input className="inv-desc" value={e.description ?? l.description} placeholder="Без названия" aria-label="Описание позиции" onChange={(ev) => setEdit(l.key, { description: ev.target.value })} />
                      <div className="inv-calc">
                        {scope && scope.projectIds.length > 1 && <span className="inv-proj">{l.projectName}</span>}
                        <input inputMode="decimal" aria-label="Часы" value={e.hours ?? String(l.hours)} onChange={(ev) => setEdit(l.key, { hours: ev.target.value })} />
                        <span>ч ×</span>
                        <input inputMode="decimal" aria-label="Ставка" value={e.rate ?? String(l.rate)} onChange={(ev) => setEdit(l.key, { rate: ev.target.value })} />
                        <strong>{lineAmount(hours * 3600, rate).amount.toFixed(2)}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {mixedCurrency && <p className="hint overdue-text">Проекты в разных валютах. Оставьте в счёте одну валюту.</p>}
          </section>

          <section>
            <h3>Условия</h3>
            <div className="form-stack">
              <div className="grid2">
                <label className="field">
                  <span>Номер</span>
                  <input value={number} aria-invalid={numberTaken} onChange={(e) => setNumberText(e.target.value)} />
                </label>
                <label className="field">
                  <span>Дата выставления</span>
                  <DateField value={issue} onChange={setIssue} />
                </label>
              </div>
              {numberTaken && <p className="hint overdue-text">Счёт с таким номером уже есть.</p>}
              <div className="grid2">
                <div className="field">
                  <span>Срок оплаты</span>
                  <NumberField ariaLabel="Срок оплаты" value={days} unit="дн." min={0} max={365} onChange={setDueDays} />
                </div>
                <div className="field">
                  <span>Язык счёта</span>
                  <Segmented<Lang>
                    label="Язык счёта"
                    value={lang}
                    onChange={setLang}
                    options={[
                      { value: 'ru', label: 'Русский' },
                      { value: 'en', label: 'English' }
                    ]}
                  />
                </div>
              </div>
              <div className="grid2">
                <div className="field">
                  <span>Скидка</span>
                  <NumberField ariaLabel="Скидка" value={discountPct} unit="%" min={0} max={100} onChange={setDiscountPct} />
                </div>
                <div className="field">
                  <span>Налог / НДС</span>
                  <NumberField ariaLabel="Налог" value={taxPct} unit="%" min={0} max={100} onChange={setTaxPct} />
                </div>
              </div>
            </div>
          </section>

          <details className="inv-fold" open={!sender.name}>
            <summary>
              Ваши данные <em>{sender.name || 'не заполнено'}</em>
            </summary>
            <div className="form-stack">
              <input placeholder="Имя или компания" value={sender.name} onChange={(e) => setSender({ ...sender, name: e.target.value })} />
              <textarea rows={2} placeholder="Адрес" value={sender.address} onChange={(e) => setSender({ ...sender, address: e.target.value })} />
              <input placeholder="Email" value={sender.email} onChange={(e) => setSender({ ...sender, email: e.target.value })} />
              <textarea rows={4} placeholder={'Реквизиты для оплаты\nБанк, счёт / IBAN, SWIFT'} value={sender.payment} onChange={(e) => setSender({ ...sender, payment: e.target.value })} />
            </div>
          </details>

          <details className="inv-fold" open={!party.address && !party.email}>
            <summary>
              Данные клиента <em>{party.name || 'не заполнено'}</em>
            </summary>
            <div className="form-stack">
              <input placeholder="Название клиента" value={party.name} onChange={(e) => setPartyEdit({ ...partyEdit, name: e.target.value })} />
              <textarea rows={2} placeholder="Адрес" value={party.address} onChange={(e) => setPartyEdit({ ...partyEdit, address: e.target.value })} />
              <div className="grid2">
                <input placeholder="Email" value={party.email} onChange={(e) => setPartyEdit({ ...partyEdit, email: e.target.value })} />
                <input placeholder="ИНН / налоговый номер" value={party.taxId} onChange={(e) => setPartyEdit({ ...partyEdit, taxId: e.target.value })} />
              </div>
            </div>
          </details>

          <details className="inv-fold" open={Boolean(notes)}>
            <summary>
              Примечания <em>{notes ? 'есть' : 'нет'}</em>
            </summary>
            <textarea rows={3} placeholder="Условия оплаты, комментарии" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </details>
        </div>

        <div className="invoice-side">
          <div className="invoice-actions">
            <div>
              <div className="muted small">К оплате</div>
              <strong className="invoice-sum">
                {totals.total.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
              </strong>
            </div>
            <div className="row gap">
              <button className="btn subtle" onClick={() => void save(false)} disabled={!canSave}>
                Сохранить
              </button>
              <button className="btn primary" onClick={() => void save(true)} disabled={!canSave}>
                <Printer size={16} /> Сохранить и скачать PDF
              </button>
            </div>
          </div>
          <div className="invoice-preview" aria-label="Предпросмотр счёта">
            <div className="invoice-scale">
              <InvoicePaper doc={doc} />
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** A saved invoice as the document it was issued as. */
export function recordToDoc(inv: InvoiceRecord, projectName: string, color: string): InvoiceDoc {
  return {
    lang: inv.lang,
    number: inv.number,
    issue: inv.issueDate,
    due: inv.dueDate,
    periodFrom: inv.periodFrom,
    periodTo: inv.periodTo,
    projectName,
    color,
    currency: inv.currency,
    sender: inv.sender,
    client: inv.client,
    lines: inv.lines.map((l, i) => ({ key: String(i), ...l })),
    totalHours: inv.totalHours,
    subtotal: inv.subtotal,
    discountPct: inv.discountPct,
    discount: inv.discount,
    taxPct: inv.taxPct,
    tax: inv.tax,
    total: inv.total,
    notes: inv.notes
  };
}

export { PrintPortal };
