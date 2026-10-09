import { useEffect } from 'react';
import { ambient, SOUNDS } from '../ambient.js';
import { useApp } from '../ctx.js';
import { Music } from '../icons.js';
import { Popover, Segmented, Switch } from '../ui.js';

function Preview() {
  useEffect(() => {
    ambient.setPreview(true);
    return () => ambient.setPreview(false);
  }, []);
  return null;
}

/** Sound mixer. While it is open the mix plays, so it can be tuned by ear. */
export function AmbientMixer() {
  const { settings, setSettings } = useApp();
  const a = settings.ambient;
  const set = (patch: Partial<typeof a>) => setSettings({ ambient: { ...a, ...patch } });

  return (
    <Popover
      align="right"
      trigger={(open, toggle) => (
        <button className={a.enabled ? 'tool on' : 'tool'} onClick={toggle} aria-expanded={open} title="Фоновые звуки" aria-label="Фоновые звуки">
          <Music size={16} /> <span className="tool-label">Звук</span>
        </button>
      )}
    >
      {() => (
        <div className="mixer">
          <Preview />
          <Switch checked={a.enabled} onChange={(enabled) => set({ enabled })} label="Фоновые звуки" />
          <Segmented<'work' | 'always'>
            label="Когда играть"
            value={a.when}
            onChange={(when) => set({ when })}
            options={[
              { value: 'work', label: 'Пока работаю' },
              { value: 'always', label: 'Всегда' }
            ]}
          />
          <label className="mixer-row">
            <span>Общая громкость</span>
            <input type="range" min={0} max={100} value={Math.round(a.master * 100)} onChange={(e) => set({ master: Number(e.target.value) / 100 })} aria-label="Общая громкость" />
          </label>
          <div className="mixer-sep" />
          {SOUNDS.map((s) => (
            <label key={s.id} className="mixer-row" title={s.hint}>
              <span>{s.label}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((a.mix[s.id] ?? 0) * 100)}
                onChange={(e) => set({ mix: { ...a.mix, [s.id]: Number(e.target.value) / 100 } })}
                aria-label={s.label}
              />
            </label>
          ))}
          <p className="hint">Играет по правилу выше: во время работы, на перерыве тишина.</p>
        </div>
      )}
    </Popover>
  );
}
