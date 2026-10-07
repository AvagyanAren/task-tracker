import { DateField, Select, TimeField } from './fields.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Dollar, Focus, Pencil, Play, Plus, Square, Timer as TimerIcon } from '../icons.js';
import type { Entry } from '../../shared/types.js';
import { entrySeconds } from '../../shared/report.js';
import { dayKey, formatClock, isoToLocalTime, localToIso, parseDuration, resolveStartTime } from '../../shared/time.js';
import { findTrigger, stripTrigger } from '../../shared/mentions.js';
import { formatCountdown } from '../../shared/pomodoro.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { ProjectDot, Segmented } from '../ui.js';
import type { PomoApi } from '../usePomodoro.js';
import { AmbientMixer } from './AmbientMixer.js';
import { ProjectPicker } from './ProjectPicker.js';
import { TagPicker } from './TagPicker.js';

type Mode = 'timer' | 'manual';

interface Props {
  pomo: PomoApi;
  onFocus: () => void;
}

export function TimerBar({ pomo, onFocus }: Props) {
  const { state, now, tz, run, fail, notify, startTimer, stopTimer, addEntry, discardEntry } = useApp();
  const running: Entry | undefined = state.entries.find((e) => e.end === null);
  const [mode, setMode] = useState<Mode>('timer');

  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [billable, setBillable] = useState(true);
  const descRef = useRef<HTMLInputElement>(null);

  // manual mode
  const today = dayKey(now, tz);
  const [mDay, setMDay] = useState(today);
  const [mStart, setMStart] = useState('09:00');
  const [mEnd, setMEnd] = useState('10:00');
  const [mDur, setMDur] = useState('1:00');
  const [mError, setMError] = useState<string | null>(null);

  const [editingStart, setEditingStart] = useState<string | null>(null);
  const [suggestIdx, setSuggestIdx] = useState(0);

  // While a timer runs the fields show (and edit) that entry.
  useEffect(() => {
    if (running) {
      setDescription(running.description);
      setProjectId(running.projectId);
      setTags(running.tags);
      setBillable(running.billable);
    }
  }, [running?.id]);

  // Hotkeys and other parts of the app talk to the bar through DOM events.
  useEffect(() => {
    const focus = () => descRef.current?.focus();
    const setM = (e: Event) => {
      setMode((e as CustomEvent<Mode>).detail);
      setTimeout(focus, 0);
    };
    window.addEventListener('tempo:focus-desc', focus);
    window.addEventListener('tempo:mode', setM);
    return () => {
      window.removeEventListener('tempo:focus-desc', focus);
      window.removeEventListener('tempo:mode', setM);
    };
  }, []);

  const known = useMemo(() => [...new Set(state.entries.flatMap((e) => e.tags))], [state.entries]);

  /* ---------- @project / #tag suggestions ---------- */
  const trigger = findTrigger(description);
  const suggestions = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    if (trigger.kind === '@') {
      return state.projects
        .filter((p) => !p.archived && p.name.toLowerCase().includes(q))
        .slice(0, 6)
        .map((p) => ({ key: p.id, label: p.name, color: p.color, pick: () => setProjectId(p.id) }));
    }
    const list = known.filter((t) => t.toLowerCase().includes(q)).slice(0, 5);
    const out = list.map((t) => ({
      key: t,
      label: `#${t}`,
      color: undefined as string | undefined,
      pick: () => setTags((cur) => (cur.some((c) => c.toLowerCase() === t.toLowerCase()) ? cur : [...cur, t]))
    }));
    if (q && !known.some((t) => t.toLowerCase() === q)) {
      out.push({ key: `new:${q}`, label: `Создать #${trigger.query}`, color: undefined, pick: () => setTags((cur) => [...cur, trigger.query]) });
    }
    return out;
  }, [trigger?.kind, trigger?.query, state.projects, known]);

  const applySuggestion = (i: number) => {
    const s = suggestions[i];
    if (!s || !trigger) return;
    s.pick();
    const next = stripTrigger(description, trigger);
    setDescription(next);
    setSuggestIdx(0);
    if (running) {
      // the pick above updated local state; persist after it settles
      setTimeout(() => descRef.current?.dispatchEvent(new Event('tempo:save')), 0);
    }
  };

  /* ---------- actions ---------- */
  const saveRunning = (patch: Parameters<typeof api.updateEntry>[1]) => {
    if (running) void run(() => api.updateEntry(running.id, patch));
  };

  // Persist project/tags/billable edits made while a timer runs.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!running) return;
    const changed =
      running.projectId !== projectId ||
      running.billable !== billable ||
      running.tags.join('\u0000') !== tags.join('\u0000');
    if (changed) saveRunning({ projectId, billable, tags });
  }, [projectId, billable, tags]);

  const start = async () => {
    const ok = await startTimer(description.trim(), projectId, tags, billable);
    if (ok && !running) {
      setDescription('');
    }
  };

  const stop = () => {
    // A tap on start/stop by mistake: a timer under 10 seconds without a name is not worth keeping.
    if (running && seconds < 10 && !running.description.trim()) {
      notify('Таймер короче 10 секунд без названия не сохранён');
      return discardEntry(running.id);
    }
    return stopTimer();
  };

  const commitStart = () => {
    if (editingStart === null || !running) return;
    const iso = resolveStartTime(editingStart, now, tz);
    setEditingStart(null);
    if (!iso) return fail('Введите время как 09:30.');
    if (iso !== running.start) saveRunning({ start: iso });
  };

  const addManual = async () => {
    setMError(null);
    const start = localToIso(mDay, mStart, tz);
    const end = localToIso(mDay, mEnd, tz);
    if (Date.parse(end) <= Date.parse(start)) return setMError('Конец должен быть позже начала.');
    const ok = await addEntry({ description: description.trim(), projectId, tags, billable, start, end });
    if (ok) setDescription('');
  };

  const syncFromTimes = (s: string, e: string) => {
    const sec = (Date.parse(localToIso(mDay, e, tz)) - Date.parse(localToIso(mDay, s, tz))) / 1000;
    if (sec > 0) setMDur(formatClock(sec).replace(/:\d\d$/, ''));
  };

  const onDescKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestIdx);
        return;
      }
      if (e.key === 'Escape') {
        setDescription(stripTrigger(description, trigger!));
        return;
      }
    }
    if (e.key === 'Enter') {
      if (running) saveRunning({ description: description.trim() });
      else if (mode === 'timer') void start();
      else void addManual();
    }
  };

  const seconds = running ? entrySeconds(running, now) : 0;
  const project = state.projects.find((p) => p.id === projectId);

  return (
    <div className={`timerbar ${running ? 'running' : ''}`}>
      <div className="timerbar-top">
        <div className="desc-wrap">
          <input
            ref={descRef}
            className="timer-desc"
            placeholder={mode === 'timer' ? 'Над чем работаете? Подсказка: @проект  #тег' : 'Что делали? Подсказка: @проект  #тег'}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSuggestIdx(0);
            }}
            onBlur={() => running && description.trim() !== running.description && saveRunning({ description: description.trim() })}
            onKeyDown={onDescKey}
            aria-label="Описание задачи"
          />
          {suggestions.length > 0 && (
            <div className="suggest" role="listbox">
              {suggestions.map((s, i) => (
                <button
                  key={s.key}
                  role="option"
                  aria-selected={i === suggestIdx}
                  className={i === suggestIdx ? 'menu-item active' : 'menu-item'}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(i);
                  }}
                >
                  {s.color && <ProjectDot color={s.color} />} {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === 'timer' ? (
          <div className="timerbar-run">
            {running && (
              <div className="startedat">
                {editingStart === null ? (
                  <button className="link-btn" title="Изменить время старта" onClick={() => setEditingStart(isoToLocalTime(running.start, tz))}>
                    <Pencil size={12} /> с {isoToLocalTime(running.start, tz)}
                  </button>
                ) : (
                  <input
                    className="mini-time"
                    autoFocus
                    value={editingStart}
                    onChange={(e) => setEditingStart(e.target.value)}
                    onBlur={commitStart}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitStart();
                      if (e.key === 'Escape') setEditingStart(null);
                    }}
                    placeholder="09:30"
                    aria-label="Время старта"
                  />
                )}
              </div>
            )}
            <div className={running ? 'clock live' : 'clock'} aria-live="off">
              {formatClock(seconds)}
            </div>
            {running ? (
              <button className="btn stop round" onClick={stop} aria-label="Стоп" title="Стоп (S)">
                <Square size={18} solid />
              </button>
            ) : (
              <button className="btn play round" onClick={start} aria-label="Старт" title="Старт (N)">
                <Play size={20} solid />
              </button>
            )}
          </div>
        ) : (
          <div className="timerbar-run">
            <button className="btn primary" onClick={addManual}>
              <Plus size={16} /> Добавить
            </button>
          </div>
        )}
      </div>

      {mode === 'manual' && (
        <div className="manual-row">
          <label>
            <span>Дата</span>
            <DateField value={mDay} onChange={setMDay} />
          </label>
          <label>
            <span>Начало</span>
            <TimeField value={mStart} ariaLabel="Начало" onChange={(t) => { setMStart(t); syncFromTimes(t, mEnd); }} />
          </label>
          <label>
            <span>Конец</span>
            <TimeField value={mEnd} ariaLabel="Конец" onChange={(t) => { setMEnd(t); syncFromTimes(mStart, t); }} />
          </label>
          <label>
            <span>Длительность</span>
            <input
              value={mDur}
              onChange={(e) => {
                setMDur(e.target.value);
                const sec = parseDuration(e.target.value);
                if (sec && sec > 0) {
                  const end = isoToLocalTime(new Date(Date.parse(localToIso(mDay, mStart, tz)) + sec * 1000).toISOString(), tz);
                  setMEnd(end);
                }
              }}
              placeholder="1:30"
            />
          </label>
          {mError && <span className="error inline">{mError}</span>}
        </div>
      )}

      <div className="timerbar-meta">
        <div className="timerbar-tools">
          <ProjectPicker projects={state.projects} value={projectId} onChange={setProjectId} />
          <TagPicker value={tags} known={known} onChange={setTags} />
          <button
            type="button"
            className={billable ? 'tool on' : 'tool'}
            onClick={() => setBillable((b) => !b)}
            title={billable ? 'Оплачиваемое время (нажмите, чтобы отключить)' : 'Не оплачивается (нажмите, чтобы включить)'}
            aria-pressed={billable}
          >
            <Dollar size={16} /> <span className="tool-label">{billable ? 'Оплата' : 'Без оплаты'}</span>
          </button>
        </div>

        <div className="timerbar-extras">
          {project && mode === 'timer' && !running && project.rate > 0 && (
            <span className="muted small rate-hint">
              {project.rate} {project.currency}/ч
            </span>
          )}
          {pomo.session && (
            <span className="pomo-chip" title="Pomodoro">
              🍅 {pomo.session.phase === 'work' ? 'Работа' : 'Перерыв'} {formatCountdown(pomo.remaining)}
            </span>
          )}
          {pomo.enabled && pomo.goal > 0 && (
            <span className={pomo.doneToday >= pomo.goal ? 'goal-chip done' : 'goal-chip'} title="Помидоров сегодня / цель на день">
              {pomo.doneToday}/{pomo.goal}
            </span>
          )}
          <AmbientMixer />
          <button className={pomo.enabled ? 'tool on' : 'tool'} onClick={pomo.toggle} title="Pomodoro: 25 мин работы / 5 мин перерыв" aria-pressed={pomo.enabled} aria-label="Pomodoro">
            🍅 <span className="tool-label">Pomodoro</span>
          </button>
          <button className="tool" onClick={onFocus} disabled={!running} title="Режим фокуса (только таймер)" aria-label="Режим фокуса">
            <Focus size={16} /> <span className="tool-label">Фокус</span>
          </button>
          <Segmented<Mode>
            label="Режим"
            value={mode}
            onChange={(m) => setMode(m)}
            options={[
              { value: 'timer', label: <><TimerIcon size={14} /> Таймер</>, title: 'Таймер (N)' },
              { value: 'manual', label: <><Clock size={14} /> Вручную</>, title: 'Добавить время вручную (M)' }
            ]}
          />
        </div>
      </div>
    </div>
  );
}
