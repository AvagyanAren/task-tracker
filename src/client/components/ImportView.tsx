import { useState } from 'react';
import { formatHM } from '../../shared/time.js';
import { api, tzOffset, type ImportSummary } from '../api.js';
import { useApp } from '../ctx.js';
import { Check, FileImport } from '../icons.js';

export function ImportView({ onGoReports }: { onGoReports: () => void }) {
  const { setState } = useApp();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    setError(null);
    setPreview(null);
    setDone(null);
    if (!file) return;
    try {
      setBusy(true);
      const text = await file.text();
      setCsv(text);
      setFileName(file.name);
      setPreview((await api.importPreview(text)).summary);
    } catch (err) {
      setCsv(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!csv) return;
    try {
      setBusy(true);
      const r = await api.importToggl(csv);
      setState(r.state);
      setDone(r.summary);
      setPreview(null);
      setCsv(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const day = (iso: string | null) => (iso ? new Date(Date.parse(iso) + tzOffset() * 60000).toISOString().slice(0, 10).split('-').reverse().join('.') : '');
  const off = tzOffset();

  return (
    <div className="page narrow-page">
      <header className="page-head">
        <div>
          <h1>Импорт из Toggl</h1>
          <p className="muted">
            В Toggl: <strong>Reports → Detailed → Export → CSV</strong>
          </p>
        </div>
      </header>

      <section className="panel">
        <label className="dropzone">
          <FileImport size={28} />
          <strong>{fileName || 'Выберите CSV-файл'}</strong>
          <span className="muted">Часовой пояс: UTC{off >= 0 ? '+' : ''}{off / 60}</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </section>

      {error && <p className="error">{error}</p>}

      {preview && (
        <section className="panel">
          <h3>Что будет импортировано</h3>
          <dl className="facts">
            <div><dt>Новых записей</dt><dd>{preview.newEntries} · {formatHM(preview.newSeconds)}</dd></div>
            <div><dt>Период</dt><dd>{day(preview.from)} — {day(preview.to)}</dd></div>
            <div><dt>Уже есть (пропустим)</dt><dd>{preview.duplicates}</dd></div>
            <div><dt>Нулевой длины (пропустим)</dt><dd>{preview.zeroLength}</dd></div>
            <div>
              <dt>Новые проекты</dt>
              <dd>{preview.newProjects.length ? preview.newProjects.join(', ') : 'нет'}</dd>
            </div>
          </dl>
          {preview.newProjects.length > 0 && <p className="hint">Ставка новых проектов — 0. Задайте её в «Проектах».</p>}
          <button className="btn primary" disabled={busy || preview.newEntries === 0} onClick={() => void doImport()}>
            Импортировать
          </button>
        </section>
      )}

      {done && (
        <section className="panel ok">
          <h3>
            <Check size={18} /> Готово
          </h3>
          <p>
            Добавлено записей: {done.newEntries} ({formatHM(done.newSeconds)}), новых проектов: {done.newProjects.length}.
          </p>
          <button className="btn subtle" onClick={onGoReports}>
            Открыть отчёты
          </button>
        </section>
      )}
    </div>
  );
}
