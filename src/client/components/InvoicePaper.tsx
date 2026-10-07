import { formatInvoiceDate, formatInvoiceHours, formatInvoiceMoney, type Lang } from '../../shared/invoice.js';
import type { Party } from '../../shared/types.js';

export interface InvoiceDoc {
  lang: Lang;
  number: string;
  issue: string;
  due: string;
  periodFrom: string;
  periodTo: string;
  projectName: string;
  color: string;
  currency: string;
  sender: Party & { payment: string };
  client: Party & { taxId?: string };
  lines: Array<{ key: string; description: string; hours: number; rate: number; amount: number }>;
  totalHours: number;
  subtotal: number;
  discountPct: number;
  discount: number;
  taxPct: number;
  tax: number;
  total: number;
  notes: string;
}

const T = {
  ru: {
    title: 'Счёт',
    number: 'Номер',
    issued: 'Дата выставления',
    due: 'Оплатить до',
    period: 'Период',
    project: 'Проект',
    from: 'От кого',
    billTo: 'Кому',
    description: 'Описание работ',
    hours: 'Часы',
    rate: 'Ставка / ч',
    amount: 'Сумма',
    totalHours: 'Всего часов',
    subtotal: 'Сумма',
    discount: 'Скидка',
    tax: 'Налог',
    taxId: 'ИНН',
    totalDue: 'К оплате',
    payment: 'Реквизиты для оплаты',
    notes: 'Примечания',
    thanks: 'Спасибо за сотрудничество!',
    untitled: 'Без названия',
    empty: 'Нет позиций'
  },
  en: {
    title: 'Invoice',
    number: 'Number',
    issued: 'Issue date',
    due: 'Due date',
    period: 'Period',
    project: 'Project',
    from: 'From',
    billTo: 'Bill to',
    description: 'Description',
    hours: 'Hours',
    rate: 'Rate / hr',
    amount: 'Amount',
    totalHours: 'Total hours',
    subtotal: 'Subtotal',
    discount: 'Discount',
    tax: 'Tax',
    taxId: 'Tax ID',
    totalDue: 'Total due',
    payment: 'Payment details',
    notes: 'Notes',
    thanks: 'Thank you for your business!',
    untitled: 'Untitled',
    empty: 'No items'
  }
} as const;

function PartyBlock({ party, fallback, taxLabel }: { party: Party & { taxId?: string }; fallback: string; taxLabel: string }) {
  return (
    <div className="inv-party">
      <strong>{party.name || fallback}</strong>
      {party.address && <span className="inv-lines">{party.address}</span>}
      {party.email && <span>{party.email}</span>}
      {party.taxId && (
        <span>
          {taxLabel}: {party.taxId}
        </span>
      )}
    </div>
  );
}

/** The printable invoice. Always light, A4, independent of the app theme. */
export function InvoicePaper({ doc }: { doc: InvoiceDoc }) {
  const t = T[doc.lang];
  const money = (n: number) => formatInvoiceMoney(n, doc.currency, doc.lang);
  const date = (d: string) => formatInvoiceDate(d, doc.lang);

  return (
    <article className="inv-paper" lang={doc.lang}>
      <div className="inv-bar" style={{ background: doc.color }} />
      <header className="inv-head">
        <div>
          <h1>{t.title}</h1>
          <div className="inv-num">№ {doc.number}</div>
        </div>
        <div className="inv-brand">{doc.sender.name}</div>
      </header>

      <section className="inv-meta">
        <div>
          <span>{t.issued}</span>
          <strong>{date(doc.issue)}</strong>
        </div>
        <div>
          <span>{t.due}</span>
          <strong>{date(doc.due)}</strong>
        </div>
        <div>
          <span>{t.period}</span>
          <strong>
            {date(doc.periodFrom)} – {date(doc.periodTo)}
          </strong>
        </div>
        <div>
          <span>{t.project}</span>
          <strong>{doc.projectName}</strong>
        </div>
      </section>

      <section className="inv-parties">
        <div>
          <h4>{t.from}</h4>
          <PartyBlock party={doc.sender} fallback="—" taxLabel={t.taxId} />
        </div>
        <div>
          <h4>{t.billTo}</h4>
          <PartyBlock party={doc.client} fallback="—" taxLabel={t.taxId} />
        </div>
      </section>

      <table className="inv-table">
        <thead>
          <tr>
            <th>{t.description}</th>
            <th className="r">{t.hours}</th>
            <th className="r">{t.rate}</th>
            <th className="r">{t.amount}</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.key}>
              <td>{l.description || t.untitled}</td>
              <td className="r">{formatInvoiceHours(l.hours, doc.lang)}</td>
              <td className="r">{money(l.rate)}</td>
              <td className="r">{money(l.amount)}</td>
            </tr>
          ))}
          {doc.lines.length === 0 && (
            <tr>
              <td colSpan={4} className="inv-none">
                {t.empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="inv-total">
        <div className="inv-total-row">
          <span>{t.totalHours}</span>
          <strong>{formatInvoiceHours(doc.totalHours, doc.lang)}</strong>
        </div>
        {(doc.discount > 0 || doc.tax > 0) && (
          <>
            <div className="inv-total-row">
              <span>{t.subtotal}</span>
              <strong>{money(doc.subtotal)}</strong>
            </div>
            {doc.discount > 0 && (
              <div className="inv-total-row">
                <span>
                  {t.discount} {doc.discountPct}%
                </span>
                <strong>−{money(doc.discount)}</strong>
              </div>
            )}
            {doc.tax > 0 && (
              <div className="inv-total-row">
                <span>
                  {t.tax} {doc.taxPct}%
                </span>
                <strong>{money(doc.tax)}</strong>
              </div>
            )}
          </>
        )}
        <div className="inv-total-due">
          <span>{t.totalDue}</span>
          <strong>{money(doc.total)}</strong>
        </div>
      </section>

      {doc.sender.payment.trim() && (
        <section className="inv-block">
          <h4>{t.payment}</h4>
          <p className="inv-lines">{doc.sender.payment}</p>
        </section>
      )}
      {doc.notes.trim() && (
        <section className="inv-block">
          <h4>{t.notes}</h4>
          <p className="inv-lines">{doc.notes}</p>
        </section>
      )}

      <footer className="inv-foot">{t.thanks}</footer>
    </article>
  );
}
