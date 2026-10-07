import { useState } from 'react';
import { api } from '../api.js';
import { Timer } from '../icons.js';

/** Shown by the online version until the shared password is entered. */
export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <span className="brand-mark">
          <Timer size={22} />
        </span>
        <h1>Tempo</h1>
        <p className="muted">Введите пароль, чтобы открыть трекер времени.</p>
        <input type="password" autoFocus autoComplete="current-password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Пароль" />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy || !password}>
          Войти
        </button>
      </form>
    </div>
  );
}
