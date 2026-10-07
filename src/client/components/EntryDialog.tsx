import { useMemo, useState } from 'react';
import type { Entry } from '../../shared/types.js';
import { dayKey, formatClock, isoToLocalTime, localToIso, parseDuration } from '../../shared/time.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { Dollar } from '../icons.js';
import { Dialog } from '../ui.js';
import { ProjectPicker } from './ProjectPicker.js';
import { TagPicker } from './TagPicker.js';

interface Props {
  /** Edit this entry… */
  entry?: Entry;
  /** …or create a new one in this period (calendar drag). */
  prefill?: { start: string; end: string };
  onClose: () => void;
}

export function EntryDialog({ entry, prefill, onClose }: Props) {
  const { state, tz, run } = useApp();
  const editing = Boolean(entry);
  const startIso = entry?.start ?? prefill?.start ?? new Date().toISOString();
  const endIso = entry?.end ?? prefill?.end ?? null;

  const [description, setDescription] = useState(entry?.description ?? '');
  const [projectId, setProjectId] = useState<string | null>(entry?.projectId ?? null);
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const [startDay, setStartDay] = useState(dayKey(startIso, tz));
  const [startTime, setStartTime] = useState(isoToLocalTime(startIso, tz));
  const [endDay, setEndDay] = useState(endIso ? dayKey(endIso, tz) : dayKey(startIso, tz));
  const [endTime, setEndTime] = useState(endIso ? isoToLocalTime(endIso, tz) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => [...new Set(state.entries.flatMap((e) => e.tags))], [state.entries]);
  const isRunning = editing && entry?.end === null;

  const startMs = Date.parse(localToIso(startDay, startTime || '00:00', tz));
  const endMs = endTime ? Date.parse(localToIso(endDay, endTime, tz)) : NaN;
  const duration = Number.isFinite(endMs) && endMs > startMs ? formatClock((endMs - startMs) / 1000).replace(/:\d\d$/, '') : '';

  const setDuration = (text: string) => {
    const sec = parseDuration(text);
    if (!sec || sec <= 0) return;
    const end = new Date(startMs + sec * 1000).toISOString();
    setEndDay(dayKey(end, tz));
    setEndTime(isoToLocalTime(end, tz));
  };

  const submit = async () => {
    setError(null);
    const start = localToIso(startDay, startTime, tz);
    let end: string | null = null;
    if (!isRunning) {
      if (!endTime) return setError('Укажите время конца.');
      end = localToIso(endDay, endTime, tz);
      if (Date.parse(end) <= Date.parse(start)) return setError('Конец должен быть позже начала.');
    }
    setBusy(true);
    const ok = editing
      ? await run(() => api.updateEntry(entry!.id, { description: description.trim(), projectId, tags, billable, start, ...(end ? { end } : {}) }))
      : await run(() => api.addEntry({ description: description.trim(), projectId, tags, billable, start, end: end! }));
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog title={editing ? 'Правка записи' : 'Новая запись'} onClose={onClose}>
      <div className="form-stack">
        <label>
          <span>Задача</span>
          <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Что делали" />
        </label>

        <div className="row wrap gap">
          <ProjectPicker projects={state.projects} value={projectId} onChange={setProjectId} includeId={entry?.projectId} />
          <TagPicker value={tags} known={known} onChange={setTags} />
          <button type="button" className={billable ? 'tool on' : 'tool'} aria-pressed={billable} onClick={() => setBillable((b) => !b)} title="Оплачиваемое время">
            <Dollar size={17} />
            <span className="tool-label">{billable ? 'Оплачивается' : 'Не оплачивается'}</span>
          </button>
        </div>

        <div className="grid2">
          <label>
            <span>Начало</span>
            <input type="date" value={startDay} onChange={(e) => setStartDay(e.target.value)} />
          </label>
          <label>
            <span>Время</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
        </div>

        {!isRunning && (
          <>
            <div className="grid2">
              <label>
                <span>Конец</span>
                <input type="date" value={endDay} onChange={(e) => setEndDay(e.target.value)} />
              </label>
              <label>
                <span>Время</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </div>
            <label>
              <span>Длительность</span>
              <input key={duration} defaultValue={duration} onBlur={(e) => setDuration(e.target.value)} placeholder="1:30" />
            </label>
          </>
        )}

        {error && <p className="error">{error}</p>}
        <div className="row end gap">
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {editing ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
