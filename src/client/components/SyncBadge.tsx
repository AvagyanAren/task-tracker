import { useEffect, useState } from 'react';

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'действие' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'действия' : 'действий');

/** Shows when there is no connection or actions saved on this device are still waiting to be sent. */
export function SyncBadge({ pending, onRetry }: { pending: number; onRetry: () => void }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online && pending === 0) return null;
  return (
    <div className={online ? 'syncbadge' : 'syncbadge offline'} role="status">
      <i className="syncbadge-dot" />
      <span>
        {online ? 'Отправляем' : 'Нет связи'}
        {pending > 0 && ` · ${pending} ${plural(pending)} ждёт`}
      </span>
      {online && pending > 0 && (
        <button className="syncbadge-retry" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}
