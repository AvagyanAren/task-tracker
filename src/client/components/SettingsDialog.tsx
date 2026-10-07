import { useState } from 'react';
import { Computer, Moon, Sun } from '../icons.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { idleSupported, requestIdlePermission } from '../useIdle.js';
import { askNotificationPermission } from '../sound.js';
import { Dialog, Segmented, Switch } from '../ui.js';
import type { Theme } from '../settings.js';

/** Backup and transfer of the whole database, plus sign-out for the online version. */
function DataSection() {
  const { state, setState, notify, fail, authRequired, logout } = useApp();
  const [pending, setPending] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');

  const download = async () => {
    try {
      const data = await api.backup();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = `tempo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  const pick = async (file: File | undefined) => {
    setPending(null);
    if (!file) return;
    try {
      setPending(JSON.parse(await file.text()));
      setFileName(file.name);
    } catch {
      fail('Не удалось прочитать файл: нужен JSON, например data/tracker.json.');
    }
  };

  const restore = async (mode: 'merge' | 'replace') => {
    if (mode === 'replace' && !confirm('Заменить ВСЕ текущие данные содержимым файла? Это нельзя отменить.')) return;
    try {
      const r = await api.restore(pending, mode);
      setState(r.state);
      setPending(null);
      notify(mode === 'replace' ? `Данные заменены: ${r.summary.entries} записей, ${r.summary.projects} проектов` : `Добавлено ${r.summary.entries} записей и ${r.summary.projects} проектов, пропущено ${r.summary.skipped}`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section>
      <h3>Данные</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Сейчас в базе: {state.entries.length} записей, {state.projects.length} проектов.
      </p>
      <div className="row gap wrap">
        <button className="btn subtle" onClick={() => void download()}>
          Скачать копию данных
        </button>
        <label className="btn subtle file-btn">
          Загрузить данные из файла
          <input type="file" accept=".json,application/json" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {authRequired && (
          <button className="btn ghost" onClick={logout}>
            Выйти
          </button>
        )}
      </div>
      {pending !== null && (
        <div className="restore-box">
          <strong>{fileName}</strong>
          <p className="hint">«Добавить» ничего не удаляет и не дублирует то, что уже есть. «Заменить» стирает текущие данные.</p>
          <div className="row gap">
            <button className="btn primary" onClick={() => void restore('merge')}>
              Добавить к текущим
            </button>
            <button className="btn ghost danger" onClick={() => void restore('replace')}>
              Заменить всё
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, setSettings, notify } = useApp();
  const [idleNote, setIdleNote] = useState<string | null>(null);
  const p = settings.pomodoro;
  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  const toggleIdle = async (on: boolean) => {
    if (!on) return setSettings({ idleEnabled: false });
    const res = await requestIdlePermission();
    if (res === 'granted') {
      setSettings({ idleEnabled: true });
      setIdleNote('Включено. Работает, пока открыта вкладка трекера.');
    } else if (res === 'unsupported') {
      setIdleNote('Этот браузер не умеет определять простой. Откройте трекер в Chrome или Edge.');
    } else {
      setIdleNote('Доступ запрещён. Разрешите «Определение простоя» в настройках сайта в браузере.');
    }
  };

  return (
    <Dialog title="Настройки" onClose={onClose}>
      <div className="form-stack">
        <section>
          <h3>Оформление</h3>
          <Segmented<Theme>
            label="Тема"
            value={settings.theme}
            onChange={(theme) => setSettings({ theme })}
            options={[
              { value: 'auto', label: <><Computer size={15} /> Как в системе</> },
              { value: 'light', label: <><Sun size={15} /> Светлая</> },
              { value: 'dark', label: <><Moon size={15} /> Тёмная</> }
            ]}
          />
        </section>

        <DataSection />

        <section>
          <h3>Записи</h3>
          <Switch checked={settings.groupSimilar} onChange={(groupSimilar) => setSettings({ groupSimilar })} label="Склеивать похожие записи за день" />
          <Switch checked={settings.hotkeys} onChange={(hotkeys) => setSettings({ hotkeys })} label="Горячие клавиши (N, S, M, C, ?)" />
        </section>

        <section>
          <h3>Определение простоя</h3>
          <Switch checked={settings.idleEnabled} onChange={toggleIdle} label="Спрашивать, что делать со временем, пока вас не было" />
          <label className="inline-field">
            <span>Считать простоем после</span>
            <input
              type="number"
              min={1}
              max={120}
              value={settings.idleMinutes}
              onChange={(e) => setSettings({ idleMinutes: num(e.target.value, 1, 120, 5) })}
            />
            <span>мин</span>
          </label>
          {!idleSupported() && <p className="hint">Нужен Chrome или Edge: другие браузеры не дают узнать о простое.</p>}
          {idleNote && <p className="hint">{idleNote}</p>}
        </section>

        <section>
          <h3>Pomodoro</h3>
          <div className="grid4">
            <label>
              <span>Работа, мин</span>
              <input type="number" min={1} max={180} value={p.workMin} onChange={(e) => setSettings({ pomodoro: { ...p, workMin: num(e.target.value, 1, 180, 25) } })} />
            </label>
            <label>
              <span>Перерыв</span>
              <input type="number" min={1} max={60} value={p.shortBreakMin} onChange={(e) => setSettings({ pomodoro: { ...p, shortBreakMin: num(e.target.value, 1, 60, 5) } })} />
            </label>
            <label>
              <span>Длинный</span>
              <input type="number" min={1} max={120} value={p.longBreakMin} onChange={(e) => setSettings({ pomodoro: { ...p, longBreakMin: num(e.target.value, 1, 120, 15) } })} />
            </label>
            <label>
              <span>Длинный после</span>
              <input type="number" min={2} max={12} value={p.longEvery} onChange={(e) => setSettings({ pomodoro: { ...p, longEvery: num(e.target.value, 2, 12, 4) } })} />
            </label>
          </div>
          <label className="inline-field">
            <span>Цель на день</span>
            <input type="number" min={0} max={30} value={p.dailyGoal} onChange={(e) => setSettings({ pomodoro: { ...p, dailyGoal: num(e.target.value, 0, 30, 8) } })} />
            <span>помидоров</span>
          </label>
          <Switch checked={p.autoStart} onChange={(autoStart) => setSettings({ pomodoro: { ...p, autoStart } })} label="Сразу начинать следующий помидор после перерыва" />
          <Switch checked={p.gentleSound} onChange={(gentleSound) => setSettings({ pomodoro: { ...p, gentleSound } })} label="Мягкий звук вместо резкого сигнала" />
          <button
            className="btn subtle"
            onClick={async () => {
              const r = await askNotificationPermission();
              notify(r === 'granted' ? 'Уведомления включены' : 'Уведомления не разрешены — останется только звук');
            }}
          >
            Разрешить уведомления
          </button>
        </section>
      </div>
    </Dialog>
  );
}
