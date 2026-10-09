import { confirmDialog } from '../confirm.js';
import { useEffect, useState } from 'react';
import { Bell, Briefcase, Check, Computer, Moon, Settings as SettingsIcon, Sun, Timer, Wallet, Download, Coffee } from '../icons.js';
import { api, type BackupInfo } from '../api.js';
import { useApp } from '../ctx.js';
import { idleSupported, requestIdlePermission } from '../useIdle.js';
import { askNotificationPermission, notificationStatus } from '../sound.js';
import { Dialog, NumberField, Segmented, SettingRow, Switch } from '../ui.js';
import { Select } from './fields.js';
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
      <SettingRow title="Резервная копия" hint={`${state.entries.length} записей`}>
        <button className="btn subtle" onClick={() => void download()}>
          Скачать
        </button>
      </SettingRow>
      <SettingRow title="Загрузить из файла" hint="JSON-копия Tempo">
        <label className="btn subtle file-btn">
          Выбрать файл
          <input type="file" accept=".json,application/json" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
      </SettingRow>
      {pending !== null && (
        <div className="restore-box">
          <strong>{fileName}</strong>
          <p className="hint">«Добавить» ничего не удаляет и не дублирует. «Заменить» стирает текущие данные.</p>
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
            <span>Раз в сутки, хранятся последние 20</span>
          </div>
          <button className="btn subtle" onClick={() => void makeCopy()}>
            Сделать копию
          </button>
        </div>
        {copies === null ? (
          <div className="skeleton" style={{ height: 44 }} />
        ) : copies.length === 0 ? (
          <p className="hint">Копий пока нет.</p>
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
        <SettingRow title="Сессия">
          <button className="btn ghost" onClick={logout}>
            Выйти
          </button>
        </SettingRow>
      )}
    </section>
  );
}

/** Sender details and invoice defaults, shared by every invoice. */
function ProfileSection() {
  const { state, run } = useApp();
  const p = state.profile;
  const [sender, setSender] = useState(p.sender);
  const [lang, setLang] = useState(p.lang);
  const [dueDays, setDueDays] = useState(p.dueDays);
  const [notes, setNotes] = useState(p.notes);
  const set = (patch: Partial<typeof sender>) => setSender((s) => ({ ...s, ...patch }));
  const dirty = JSON.stringify([sender, lang, dueDays, notes]) !== JSON.stringify([p.sender, p.lang, p.dueDays, p.notes]);
  return (
    <section className="sgroup">
      <div className="form-stack">
        <label className="field">
          <span>Ваше имя или компания</span>
          <input value={sender.name} onChange={(e) => set({ name: e.target.value })} placeholder="ИП Иванов / Tamchys Fit" />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Email</span>
            <input value={sender.email} onChange={(e) => set({ email: e.target.value })} placeholder="me@example.com" />
          </label>
          <div className="field">
            <span>Язык счёта по умолчанию</span>
            <Select<'ru' | 'en'> value={lang} ariaLabel="Язык счёта" options={[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} onChange={setLang} />
          </div>
        </div>
        <label className="field">
          <span>Адрес</span>
          <textarea rows={2} value={sender.address} onChange={(e) => set({ address: e.target.value })} />
        </label>
        <label className="field">
          <span>Реквизиты для оплаты</span>
          <textarea rows={3} value={sender.payment} onChange={(e) => set({ payment: e.target.value })} placeholder="Банк, IBAN / номер счёта, SWIFT" />
        </label>
        <div className="grid2">
          <div className="field">
            <span>Срок оплаты</span>
            <NumberField ariaLabel="Срок оплаты" value={dueDays} unit="дн." min={0} max={365} onChange={setDueDays} />
          </div>
        </div>
        <label className="field">
          <span>Примечание в конце счёта</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Спасибо за сотрудничество" />
        </label>
        <div className="row end">
          <button className="btn primary" disabled={!dirty} onClick={() => void run(() => api.saveProfile({ sender, lang, dueDays, notes }))}>
            Сохранить
          </button>
        </div>
      </div>
    </section>
  );
}

type SectionId = 'general' | 'timer' | 'pomodoro' | 'notify' | 'profile' | 'data';
const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'Основные', icon: <SettingsIcon size={17} /> },
  { id: 'timer', label: 'Таймер', icon: <Timer size={17} /> },
  { id: 'pomodoro', label: 'Pomodoro', icon: <Coffee size={17} /> },
  { id: 'notify', label: 'Уведомления', icon: <Bell size={17} /> },
  { id: 'profile', label: 'Профиль и счета', icon: <Briefcase size={17} /> },
  { id: 'data', label: 'Данные', icon: <Download size={17} /> }
];

export function SettingsDialog({ onClose, initial = 'general' }: { onClose: () => void; initial?: SectionId }) {
  const { settings, setSettings, notify } = useApp();
  const [section, setSection] = useState<SectionId>(initial);
  const [idleNote, setIdleNote] = useState<string | null>(null);
  const [perm, setPerm] = useState(notificationStatus);
  const p = settings.pomodoro;
  const setPomo = (patch: Partial<typeof p>) => setSettings({ pomodoro: { ...p, ...patch } });
  const current = SECTIONS.find((s) => s.id === section)!;

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

  const onNavKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = SECTIONS.findIndex((s) => s.id === section);
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    const next = SECTIONS[(i + d + SECTIONS.length) % SECTIONS.length];
    setSection(next.id);
    requestAnimationFrame(() => document.getElementById(`stab-${next.id}`)?.focus());
  };

  return (
    <Dialog title="Настройки" onClose={onClose} wide className="settings-dialog">
      <div className="settings-body">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Разделы настроек" onKeyDown={onNavKey}>
          {SECTIONS.map((s) => (
            <button key={s.id} id={`stab-${s.id}`} role="tab" aria-selected={section === s.id} aria-controls="spanel" tabIndex={section === s.id ? 0 : -1} className={section === s.id ? 'snav active' : 'snav'} onClick={() => setSection(s.id)}>
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panel" id="spanel" role="tabpanel" aria-labelledby={`stab-${section}`}>
          <header className="settings-head">
            <h3>{current.label}</h3>
          </header>

          {section === 'general' && (
            <section className="sgroup">
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
              <Switch checked={settings.groupSimilar} onChange={(groupSimilar) => setSettings({ groupSimilar })} label="Склеивать одинаковые записи за день" />
              <Switch checked={settings.hotkeys} onChange={(hotkeys) => setSettings({ hotkeys })} label="Горячие клавиши" />
            </section>
          )}

          {section === 'timer' && (
            <section className="sgroup">
              <Switch checked={settings.defaultBillable} onChange={(defaultBillable) => setSettings({ defaultBillable })} label="Новое время оплачивается" />
              <SettingRow title="Напомнить о долгом таймере" hint="0 — не напоминать">
                <NumberField ariaLabel="Напомнить, если таймер идёт дольше" value={settings.longTimerHours} unit="ч" min={0} max={24} onChange={(longTimerHours) => setSettings({ longTimerHours })} />
              </SettingRow>
              <Switch checked={settings.idleEnabled} onChange={toggleIdle} label="Определять простой" hint={idleSupported() ? undefined : 'Нужен Chrome или Edge'} />
              <SettingRow title="Считать простоем после">
                <NumberField ariaLabel="Считать простоем после" value={settings.idleMinutes} unit="мин" min={1} max={120} onChange={(idleMinutes) => setSettings({ idleMinutes })} />
              </SettingRow>
              {idleNote && <p className="hint">{idleNote}</p>}
            </section>
          )}

          {section === 'pomodoro' && (
            <section className="sgroup">
              <div className="nfields">
                <NumberField label="Работа" unit="мин" value={p.workMin} min={1} max={180} onChange={(workMin) => setPomo({ workMin })} />
                <NumberField label="Перерыв" unit="мин" value={p.shortBreakMin} min={1} max={60} onChange={(shortBreakMin) => setPomo({ shortBreakMin })} />
                <NumberField label="Длинный" unit="мин" value={p.longBreakMin} min={1} max={120} onChange={(longBreakMin) => setPomo({ longBreakMin })} />
                <NumberField label="Длинный после" unit="шт." value={p.longEvery} min={2} max={12} onChange={(longEvery) => setPomo({ longEvery })} />
              </div>
              <SettingRow title="Цель на день">
                <NumberField ariaLabel="Цель на день" value={p.dailyGoal} unit="шт." min={0} max={30} onChange={(dailyGoal) => setPomo({ dailyGoal })} />
              </SettingRow>
              <Switch checked={p.autoStart} onChange={(autoStart) => setPomo({ autoStart })} label="Автозапуск следующего помидора" />
            </section>
          )}

          {section === 'notify' && (
            <section className="sgroup">
              <Switch checked={p.gentleSound} onChange={(gentleSound) => setPomo({ gentleSound })} label="Мягкий звук" />
              <SettingRow
                title="Уведомления браузера"
                hint={perm === 'denied' ? 'Запрещены в браузере. Разрешите в настройках сайта.' : perm === 'unsupported' ? 'Браузер не поддерживает уведомления.' : undefined}
              >
                {perm === 'granted' ? (
                  <span className="status-ok">
                    <Check size={15} /> Включены
                  </span>
                ) : perm === 'default' ? (
                  <button
                    className="btn subtle"
                    onClick={async () => {
                      const r = await askNotificationPermission();
                      setPerm(notificationStatus());
                      notify(r === 'granted' ? 'Уведомления включены' : 'Уведомления не разрешены — останется только звук');
                    }}
                  >
                    Разрешить
                  </button>
                ) : (
                  <span className="status-off">{perm === 'denied' ? 'Запрещены' : 'Недоступны'}</span>
                )}
              </SettingRow>
            </section>
          )}

          {section === 'profile' && <ProfileSection />}
          {section === 'data' && <DataSection />}
        </div>
      </div>
    </Dialog>
  );
}

void Wallet;
