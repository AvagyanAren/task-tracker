import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildReport, type ReportQuery } from '../../shared/report.js';
import {
  buildInvoiceLines,
  formatInvoiceNumber,
  invoiceTotal,
  lineAmount,
  nextCounterAfter,
  type Lang
} from '../../shared/invoice.js';
import { addDays, dayKey } from '../../shared/time.js';
import { useApp } from '../ctx.js';
import { EMPTY_PARTY, useInvoiceProfile, type Party } from '../invoiceProfile.js';
import { Printer } from '../icons.js';
import { Dialog, Segmented } from '../ui.js';
import { InvoicePaper, type InvoiceDoc } from './InvoicePaper.js';

interface Props {
  /** The report's period and filters; the invoice covers the same range. */
  query: ReportQuery;
  fromDay: string;
  toDay: string;
  onClose: () => void;
}

/** Invoice builder: form on the left, live A4 preview on the right, print/save as PDF. */
export function InvoiceDialog({ query, fromDay, toDay, onClose }: Props) {
  const { state, now, tz, notify } = useApp();
  const [profile, update] = useInvoiceProfile();
  const today = dayKey(now, tz);
  const year = Number(today.slice(0, 4));

  // Only projects that have billable work in the period can be invoiced.
  const eligible = useMemo(
    () =>
      buildReport(state, { ...query, projectId: null, billable: true }, now, tz)
        .byProject.filter((r) => r.projectId !== null && r.seconds > 0)
        .map((r) => state.projects.find((p) => p.id === r.projectId)!)
        .filter(Boolean),
    [state, query, now, tz]
  );

  const [projectId, setProjectId] = useState(() => (typeof query.projectId === 'string' && eligible.some((p) => p.id === query.projectId) ? query.projectId : eligible[0]?.id ?? ''));
  const project = state.projects.find((p) => p.id === projectId);
  const [rateText, setRateText] = useState<string | null>(null);
  const [issue, setIssue] = useState(today);
  const [numberText, setNumberText] = useState<string | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [titles, setTitles] = useState<Record<string, string>>({});

  const rate = rateText === null ? project?.rate ?? 0 : Number(rateText.replace(',', '.')) || 0;
  const base = useMemo(
    () => (projectId ? buildInvoiceLines(state, query, projectId, now, tz, rate) : null),
    [state, query, projectId, now, tz, rate]
  );

  const lines = useMemo(
    () =>
      (base?.lines ?? [])
        .filter((l) => !off.has(l.key))
        .map((l) => ({ ...l, description: titles[l.key] ?? l.description })),
    [base, off, titles]
  );
  const total = invoiceTotal(lines);
  const totalHours = Math.round(lines.reduce((n, l) => n + l.hours, 0) * 100) / 100;

  const client: Party = profile.clients[projectId] ?? { ...EMPTY_PARTY, name: project?.name ?? '' };
  const number = numberText ?? formatInvoiceNumber(year, profile.counter);
  const lang = profile.lang;

  const doc: InvoiceDoc = {
    lang,
    number,
    issue,
    due: addDays(issue, profile.dueDays),
    periodFrom: fromDay,
    periodTo: toDay < fromDay ? fromDay : toDay,
    projectName: project?.name ?? '',
    color: project?.color ?? '#111111',
    currency: base?.currency ?? '',
    sender: profile.sender,
    client,
    lines,
    totalHours,
    total,
    notes: profile.notes
  };

  const setSender = (patch: Partial<typeof profile.sender>) => update((p) => ({ ...p, sender: { ...p.sender, ...patch } }));
  const setClient = (patch: Partial<Party>) => update((p) => ({ ...p, clients: { ...p.clients, [projectId]: { ...client, ...patch } } }));

  // Print-only copy of the paper lives directly under <body>, so the page prints
  // as one clean A4 document instead of the whole app.
  const [printRoot, setPrintRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'print-root';
    document.body.appendChild(el);
    setPrintRoot(el);
    return () => {
      el.remove();
    };
  }, []);

  const print = () => {
    const prev = document.title;
    document.title = number; // becomes the default file name in "Save as PDF"
    const restore = () => {
      document.title = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    const next = nextCounterAfter(number, year);
    if (next !== null) update((p) => ({ ...p, counter: Math.max(p.counter, next) }));
    setNumberText(null);
    notify('В окне печати выберите «Сохранить как PDF»');
    window.print();
  };

  if (eligible.length === 0) {
    return (
      <Dialog title="Инвойс" onClose={onClose}>
        <p className="lead">В выбранном периоде нет оплачиваемых записей по проектам. Выберите другой период или снимите фильтры.</p>
      </Dialog>
    );
  }

  return (
    <Dialog title="Инвойс за период" onClose={onClose} wide className="invoice-dialog">
      <div className="invoice-layout">
        <div className="invoice-form">
          <section>
            <h3>Документ</h3>
            <div className="form-stack">
              <div className="grid2">
                <label className="field">
                  <span>Проект</span>
                  <select
                    value={projectId}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      setRateText(null);
                      setOff(new Set());
                      setTitles({});
                    }}
                  >
                    {eligible.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  <span>Язык</span>
                  <Segmented<Lang>
                    label="Язык инвойса"
                    value={lang}
                    onChange={(l) => update((p) => ({ ...p, lang: l }))}
                    options={[
                      { value: 'ru', label: 'Русский' },
                      { value: 'en', label: 'English' }
                    ]}
                  />
                </div>
              </div>
              <div className="grid2">
                <label className="field">
                  <span>Номер</span>
                  <input value={number} onChange={(e) => setNumberText(e.target.value)} />
                </label>
                <label className="field">
                  <span>Дата выставления</span>
                  <input type="date" value={issue} onChange={(e) => e.target.value && setIssue(e.target.value)} />
                </label>
              </div>
              <div className="grid2">
                <label className="field">
                  <span>Срок оплаты, дней</span>
                  <input type="number" min={0} max={365} value={profile.dueDays} onChange={(e) => update((p) => ({ ...p, dueDays: Math.max(0, Math.min(365, Math.round(Number(e.target.value)) || 0)) }))} />
                </label>
                <label className="field">
                  <span>Ставка в час ({base?.currency})</span>
                  <input inputMode="decimal" value={rateText ?? String(project?.rate ?? 0)} onChange={(e) => setRateText(e.target.value)} />
                </label>
              </div>
              {rateText !== null && Number(rateText.replace(',', '.')) !== project?.rate && <p className="hint">Эта ставка только для этого инвойса, проект не меняется.</p>}
            </div>
          </section>

          <section>
            <h3>Позиции</h3>
            <div className="inv-items">
              {(base?.lines ?? []).map((l) => {
                const included = !off.has(l.key);
                return (
                  <div key={l.key} className={included ? 'inv-item' : 'inv-item off'}>
                    <input
                      type="checkbox"
                      checked={included}
                      aria-label="Включить в инвойс"
                      onChange={() =>
                        setOff((s) => {
                          const n = new Set(s);
                          if (n.has(l.key)) n.delete(l.key);
                          else n.add(l.key);
                          return n;
                        })
                      }
                    />
                    <input
                      value={titles[l.key] ?? l.description}
                      placeholder="Без названия"
                      onChange={(e) => setTitles((t) => ({ ...t, [l.key]: e.target.value }))}
                      aria-label="Описание позиции"
                    />
                    <span className="inv-item-sum">{lineAmount(l.seconds, rate).hours.toFixed(2)} ч</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3>Ваши данные</h3>
            <div className="form-stack">
              <input placeholder="Имя или компания" value={profile.sender.name} onChange={(e) => setSender({ name: e.target.value })} />
              <textarea rows={2} placeholder="Адрес" value={profile.sender.address} onChange={(e) => setSender({ address: e.target.value })} />
              <input placeholder="Email" value={profile.sender.email} onChange={(e) => setSender({ email: e.target.value })} />
              <textarea rows={4} placeholder={'Реквизиты для оплаты\nБанк, счёт / IBAN, SWIFT'} value={profile.sender.payment} onChange={(e) => setSender({ payment: e.target.value })} />
            </div>
          </section>

          <section>
            <h3>Клиент{project ? ` · ${project.name}` : ''}</h3>
            <div className="form-stack">
              <input placeholder="Название клиента" value={client.name} onChange={(e) => setClient({ name: e.target.value })} />
              <textarea rows={2} placeholder="Адрес" value={client.address} onChange={(e) => setClient({ address: e.target.value })} />
              <input placeholder="Email" value={client.email} onChange={(e) => setClient({ email: e.target.value })} />
            </div>
            <p className="hint">Данные хранятся в этом браузере и подставятся в следующие инвойсы этого проекта.</p>
          </section>

          <section>
            <h3>Примечания</h3>
            <textarea rows={3} placeholder="Условия оплаты, комментарии" value={profile.notes} onChange={(e) => update((p) => ({ ...p, notes: e.target.value }))} />
          </section>
        </div>

        <div className="invoice-side">
          <div className="invoice-actions">
            <div>
              <div className="muted small">Итого</div>
              <strong className="invoice-sum">{doc.total.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {doc.currency}</strong>
            </div>
            <button className="btn primary" onClick={print} disabled={lines.length === 0}>
              <Printer size={16} /> Скачать PDF
            </button>
          </div>
          <div className="invoice-preview" aria-label="Предпросмотр инвойса">
            <div className="invoice-scale">
              <InvoicePaper doc={doc} />
            </div>
          </div>
        </div>
      </div>
      {printRoot && createPortal(<InvoicePaper doc={doc} />, printRoot)}
    </Dialog>
  );
}
