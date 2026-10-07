import { confirmDialog } from '../confirm.js';
import { useEffect, useState } from 'react';
import { Computer, Moon, Sun } from '../icons.js';
import { api, type BackupInfo } from '../api.js';
import { useApp } from '../ctx.js';
import { idleSupported, requestIdlePermission } from '../useIdle.js';
import { askNotificationPermission } from '../sound.js';
import { Dialog, NumberField, Segmented, SettingRow, Switch } from '../ui.js';
import type { Theme } from '../settings.js';

/** Backup and transfer of the whole database, plus sign-out for the online version. */
function DataSection() {
  const { state, setState, notify, fail, authRequired, logout } = useApp();
  const [pending, setPending] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');

  const [copies, setCopies] = useState<BackupInfo[] | null>(null);
  const loadCopies = () => api.backups().then(setCopies, () => setCopies([]));
  useEffect(() => void loadCopies(), []);

  const makeCopy = async () => {
    try {
      await api.createBackup();
      await loadCopies();
      notify('Копия сохранена');
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  const restoreCopy = async (c: BackupInfo) => {
    const when = new Date(c.at).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    const ok = await confirmDialog({
      title: 'Вернуть эту копию?',
      text: `Данные станут такими, какими были ${when} (${c.entries} записей). Текущие данные сохранятся отдельной копией, так что вернуться обратно можно.`,
      confirmLabel: 'Вернуть',
      danger: true
    });
    if (!ok) return;
    try {
      const r = await api.restoreBackup(c.id);
      setState(r.state);
      await loadCopies();
      notify('Копия возвращена. Прежние данные сохранены отдельной копией.');
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  const downloadCopy = (c: BackupInfo) => {
    const a = document.createElement('a');
    a.href = `/api/backups/${c.id}`;
    a.download = `tempo-copy-${c.id}.json`;
    a.click();
  };

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
    if (mode === 'replace' && !(await confirmDialog({ title: 'Заменить все данные?', text: 'Текущие записи и проекты будут стёрты и заменены содержимым файла. Это нельзя отменить.', confirmLabel: 'Заменить', danger: true }))) return;
    try {
      const r = await api.restore(pending, mode);
      setState(r.state);
      setPending(null);
      notify(
        mode === 'replace'
          ? `Данные заменены: ${r.summary.entries} записей, ${r.summary.projects} проектов`
          : `Добавлено ${r.summary.entries} записей и ${r.summary.projects} проектов, пропущено ${r.summary.skipped}`
      );
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="sgroup">
      <h3>Данные</h3>
      <SettingRow title="Резервная копия" hint={`Сейчас в базе: ${state.entries.length} записей, ${state.projects.length} проектов`}>
        <button className="btn subtle" onClick={() => void download()}>
          Скачать
        </button>
      </SettingRow>
      <SettingRow title="Загрузить из файла" hint="Копия Tempo или data/tracker.json">
        <label className="btn subtle file-btn">
          Выбрать файл
          <input type="file" accept=".json,application/json" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
      </SettingRow>
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
      <div className="copies">
        <div className="copies-head">
          <div className="srow-text">
            <strong>Автоматические копии</strong>
            <span>Раз в сутки на сервере и перед каждым возвратом. Хранятся последние 20.</span>
          </div>
          <button className="btn subtle" onClick={() => void makeCopy()}>
            Сделать копию
          </button>
        </div>
        {copies === null ? (
          <div className="skeleton" style={{ height: 44 }} />
        ) : copies.length === 0 ? (
          <p className="hint">Копий пока нет. Первая появится сегодня ночью или по кнопке.</p>
        ) : (
          <ul className="copy-list">
            {copies.slice(0, 6).map((c) => (
              <li key={c.id}>
                <span>
                  <strong>{new Date(c.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</strong>
                  <em className="muted">
                    {c.entries} записей · {c.projects} проектов
                  </em>
                </span>
                <span className="row gap">
                  <button className="btn ghost sm" onClick={() => downloadCopy(c)}>
                    Скачать
                  </button>
                  <button className="btn ghost sm" onClick={() => void restoreCopy(c)}>
                    Вернуть
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {authRequired && (
        <SettingRow title="Сессия" hint="Выйти из онлайн-версии на этом устройстве">
          <button className="btn ghost" onClick={logout}>
            Выйти
          </button>
        </SettingRow>
      )}
    </section>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, setSettings, notify } = useApp();
  const [idleNote, setIdleNote] = useState<string | null>(null);
  const p = settings.pomodoro;
  const setPomo = (patch: Partial<typeof p>) => setSettings({ pomodoro: { ...p, ...patch } });

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
    <Dialog title="Настройки" onClose={onClose} wide className="settings-dialog">
      <div className="settings">
        <section className="sgroup">
          <h3>Оформление</h3>
          <SettingRow title="Тема">
            <Segmented<Theme>
              label="Тема"
              value={settings.theme}
              onChange={(theme) => setSettings({ theme })}
              options={[
                { value: 'auto', label: <><Computer size={15} /> Авто</>, title: 'Как в системе' },
                { value: 'light', label: <><Sun size={15} /> Светлая</> },
                { value: 'dark', label: <><Moon size={15} /> Тёмная</> }
              ]}
            />
          </SettingRow>
        </section>

        <section className="sgroup">
          <h3>Записи</h3>
          <Switch checked={settings.groupSimilar} onChange={(groupSimilar) => setSettings({ groupSimilar })} label="Склеивать похожие записи" hint="Одинаковые задачи за один день показываются одной строкой" />
          <Switch checked={settings.hotkeys} onChange={(hotkeys) => setSettings({ hotkeys })} label="Горячие клавиши" hint="N, S, M, C и ? — работают вне полей ввода" />
        </section>

        <section className="sgroup">
          <h3>Определение простоя</h3>
          <Switch checked={settings.idleEnabled} onChange={toggleIdle} label="Спрашивать про время, пока вас не было" hint={idleSupported() ? 'Нужно разрешение браузера' : 'Нужен Chrome или Edge: другие браузеры не сообщают о простое'} />
          <SettingRow title="Считать простоем после">
            <NumberField value={settings.idleMinutes} unit="мин" min={1} max={120} onChange={(idleMinutes) => setSettings({ idleMinutes })} />
          </SettingRow>
          {idleNote && <p className="hint">{idleNote}</p>}
        </section>

        <section className="sgroup">
          <h3>Pomodoro</h3>
          <div className="nfields">
            <NumberField label="Работа" unit="мин" value={p.workMin} min={1} max={180} onChange={(workMin) => setPomo({ workMin })} />
            <NumberField label="Перерыв" unit="мин" value={p.shortBreakMin} min={1} max={60} onChange={(shortBreakMin) => setPomo({ shortBreakMin })} />
            <NumberField label="Длинный" unit="мин" value={p.longBreakMin} min={1} max={120} onChange={(longBreakMin) => setPomo({ longBreakMin })} />
            <NumberField label="Длинный после" unit="шт." value={p.longEvery} min={2} max={12} onChange={(longEvery) => setPomo({ longEvery })} />
          </div>
          <SettingRow title="Цель на день" hint="Сколько помидоров вы хотите набрать">
            <NumberField value={p.dailyGoal} unit="шт." min={0} max={30} onChange={(dailyGoal) => setPomo({ dailyGoal })} />
          </SettingRow>
          <Switch checked={p.autoStart} onChange={(autoStart) => setPomo({ autoStart })} label="Автозапуск следующего помидора" hint="После перерыва таймер стартует сам" />
          <Switch checked={p.gentleSound} onChange={(gentleSound) => setPomo({ gentleSound })} label="Мягкий звук" hint="Плавный сигнал вместо резкого" />
          <SettingRow title="Уведомления" hint="Показывать окно, когда помидор или перерыв закончились">
            <button
              className="btn subtle"
              onClick={async () => {
                const r = await askNotificationPermission();
                notify(r === 'granted' ? 'Уведомления включены' : 'Уведомления не разрешены — останется только звук');
              }}
            >
              Разрешить
            </button>
          </SettingRow>
        </section>

        <DataSection />
      </div>
    </Dialog>
  );
}
