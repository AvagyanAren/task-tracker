import { isoToLocalTime } from '../../shared/time.js';
import { formatHM } from '../../shared/time.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import type { IdleInfo } from '../useIdle.js';
import { Dialog } from '../ui.js';

export function IdleDialog({ info, onClose }: { info: IdleInfo; onClose: () => void }) {
  const { state, tz, run } = useApp();
  const entry = state.entries.find((e) => e.id === info.entryId);
  const idleStartIso = new Date(info.idleStartMs).toISOString();

  const discard = async (andContinue: boolean) => {
    if (!entry) return onClose();
    const ok = await run(() => api.updateEntry(entry.id, { end: idleStartIso }));
    if (ok && andContinue) await run(() => api.startTimer(entry.description, entry.projectId, entry.tags, entry.billable));
    onClose();
  };

  return (
    <Dialog title="С возвращением" onClose={onClose}>
      <p className="lead">
        Вас не было <strong>{formatHM(info.idleMs / 1000)}</strong> (с {isoToLocalTime(idleStartIso, tz)}), а таймер шёл.
        {entry?.description ? <> Задача: «{entry.description}».</> : null}
      </p>
      <div className="stack-buttons">
        <button className="btn primary" onClick={() => discard(true)}>
          Убрать простой и продолжить
        </button>
        <button className="btn subtle" onClick={() => discard(false)}>
          Убрать простой и остановить таймер
        </button>
        <button className="btn ghost" onClick={onClose}>
          Оставить время как есть
        </button>
      </div>
    </Dialog>
  );
}
