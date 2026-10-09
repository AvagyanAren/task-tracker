import { confirmDialog } from '../confirm.js';
import { useMemo, useState } from 'react';
import type { Project } from '../../shared/types.js';
import { entrySeconds } from '../../shared/report.js';
import { formatHM } from '../../shared/time.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { formatMoney } from '../format.js';
import { Archive, Briefcase, Check, Pencil, Plus, Refresh, Trash, X } from '../icons.js';
import { Empty, Segmented } from '../ui.js';
import { ClientsView } from './ClientsView.js';
import { Select } from './fields.js';

const COLORS = ['#7c5cff', '#2f6feb', '#12b886', '#f59f00', '#f03e6e', '#0ea5c6', '#e8590c', '#ae3ec9'];

export function ProjectsView() {
  const { state, now, run } = useApp();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [currency, setCurrency] = useState('$');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; rate: string; currency: string; color: string; clientId: string }>({ name: '', rate: '', currency: '$', color: COLORS[0], clientId: '' });
  const [tab, setTab] = useState<'projects' | 'clients'>('projects');
  const [newClient, setNewClient] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const totals = useMemo(() => {
    const m = new Map<string, { seconds: number; count: number }>();
    for (const e of state.entries) {
      if (!e.projectId) continue;
      const t = m.get(e.projectId) ?? { seconds: 0, count: 0 };
      t.seconds += entrySeconds(e, now);
      t.count++;
      m.set(e.projectId, t);
    }
    return m;
  }, [state.entries, now]);

  const create = async () => {
    const ok = await run(() =>
      api.createProject({
        name,
        rate: rate === '' ? 0 : Number(rate.replace(',', '.')),
        currency,
        color: COLORS[state.projects.length % COLORS.length],
        clientId: newClient || null
      })
    );
    if (ok) {
      setName('');
      setRate('');
    }
  };

  const startEdit = (p: Project) => {
    setEditing(p.id);
    setDraft({ name: p.name, rate: String(p.rate), currency: p.currency, color: p.color, clientId: p.clientId ?? '' });
  };

  const save = async (id: string) => {
    const ok = await run(() =>
      api.updateProject(id, { name: draft.name, rate: Number(draft.rate.replace(',', '.')), currency: draft.currency, color: draft.color, clientId: draft.clientId || null })
    );
    if (ok) setEditing(null);
  };

  const list = state.projects.filter((p) => showArchived || !p.archived);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Проекты</h1>
        </div>
        <Segmented<'projects' | 'clients'>
          label="Раздел"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'projects', label: 'Проекты' },
            { value: 'clients', label: 'Клиенты' }
          ]}
        />
      </header>

      {tab === 'clients' ? (
        <ClientsView />
      ) : (
      <>

      <section className="panel">
        <h3>Новый проект</h3>
        <div className="new-project">
          <input placeholder="Название проекта" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} />
          <input placeholder="Ставка за час" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          <input className="narrow" title="Валюта" aria-label="Валюта" value={currency} onChange={(e) => setCurrency(e.target.value)} />
          <Select<string>
            value={newClient}
            ariaLabel="Клиент"
            placeholder="Клиент"
            options={[{ value: '', label: 'Без клиента' }, ...state.clients.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.name }))]}
            onChange={setNewClient}
          />
          <button className="btn primary" disabled={!name.trim()} onClick={() => void create()}>
            <Plus size={16} /> Создать проект
          </button>
        </div>
      </section>

      {list.length === 0 ? (
        <Empty icon={<Briefcase size={28} />} title="Проектов пока нет">
          Создайте проект выше.
        </Empty>
      ) : (
        <section className="panel flush">
          <table className="table">
            <thead>
              <tr>
                <th>Проект</th>
                <th className="num">Ставка / час</th>
                <th className="num">Всего времени</th>
                <th className="num">Заработано</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const t = totals.get(p.id) ?? { seconds: 0, count: 0 };
                const isEditing = editing === p.id;
                return (
                  <tr key={p.id} className={p.archived ? 'archived' : ''}>
                    <td>
                      {isEditing ? (
                        <span className="row gap">
                          <input type="color" aria-label="Цвет" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                          <input aria-label="Название" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                          <Select<string>
                            value={draft.clientId}
                            ariaLabel="Клиент"
                            placeholder="Клиент"
                            options={[{ value: '', label: 'Без клиента' }, ...state.clients.map((c) => ({ value: c.id, label: c.name }))]}
                            onChange={(clientId) => setDraft({ ...draft, clientId })}
                          />
                        </span>
                      ) : (
                        <span className="proj-cell">
                          <i className="dot" style={{ background: p.color }} />
                          <strong>{p.name}</strong>
                          {p.archived && <span className="badge">архив</span>}
                          {p.clientId && <span className="muted small">· {state.clients.find((c) => c.id === p.clientId)?.name ?? ''}</span>}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {isEditing ? (
                        <span className="row gap end">
                          <input className="narrow" aria-label="Ставка" inputMode="decimal" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
                          <input className="narrow" aria-label="Валюта" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} />
                        </span>
                      ) : (
                        formatMoney(p.rate, p.currency)
                      )}
                    </td>
                    <td className="num">{formatHM(t.seconds)}</td>
                    <td className="num">
                      <strong>{formatMoney(Math.round((t.seconds / 3600) * p.rate * 100) / 100, p.currency)}</strong>
                    </td>
                    <td className="num nowrap">
                      {isEditing ? (
                        <>
                          <button className="btn icon subtle" aria-label="Сохранить" title="Сохранить" onClick={() => void save(p.id)}>
                            <Check size={16} />
                          </button>
                          <button className="btn icon ghost" aria-label="Отмена" title="Отмена" onClick={() => setEditing(null)}>
                            <X size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn icon ghost" aria-label={`Изменить ${p.name}`} title="Изменить" onClick={() => startEdit(p)}>
                            <Pencil size={16} />
                          </button>
                          <button
                            className="btn icon ghost"
                            aria-label={p.archived ? `Вернуть ${p.name}` : `В архив ${p.name}`}
                            title={p.archived ? 'Вернуть из архива' : 'В архив'}
                            onClick={() => void run(() => api.updateProject(p.id, { archived: !p.archived }))}
                          >
                            {p.archived ? <Refresh size={16} /> : <Archive size={16} />}
                          </button>
                          {t.count === 0 && (
                            <button
                              className="btn icon ghost"
                              aria-label={`Удалить ${p.name}`}
                              title="Удалить"
                              onClick={async () => (await confirmDialog({ title: `Удалить проект «${p.name}»?`, text: 'Проект без записей будет удалён навсегда.', confirmLabel: 'Удалить', danger: true })) && void run(() => api.deleteProject(p.id))}
                            >
                              <Trash size={16} />
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {state.projects.some((p) => p.archived) && (
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Показывать архивные
        </label>
      )}
      </>
      )}
    </div>
  );
}
