import { useState } from 'react';
import { useApp } from '../ctx.js';
import { ChevronDown, Focus, Music } from '../icons.js';
import { Popover, Switch } from '../ui.js';
import type { PomoApi } from '../usePomodoro.js';
import { AmbientPanel } from './AmbientMixer.js';

/** Everything that helps concentrate (Pomodoro, focus view, sounds) behind one icon, so the timer bar stays calm. */
export function TimerTools({ pomo, running, onFocus }: { pomo: PomoApi; running: boolean; onFocus: () => void }) {
  const { settings } = useApp();
  const [sounds, setSounds] = useState(false);
  const active = pomo.enabled || settings.ambient.enabled;

  return (
    <Popover
      align="right"
      trigger={(open, toggle) => (
        <button className={active ? 'icon-tool on' : 'icon-tool'} onClick={toggle} aria-expanded={open} aria-haspopup="dialog" aria-label="Инструменты фокуса" title="Фокус, Pomodoro, звуки">
          <Focus size={18} />
        </button>
      )}
    >
      {(close) => (
        <div className="tools-menu">
          <div className="tools-row">
            <Switch checked={pomo.enabled} onChange={pomo.toggle} label="Pomodoro" hint={pomo.enabled && pomo.goal > 0 ? `Сегодня ${pomo.doneToday} из ${pomo.goal}` : undefined} />
          </div>
          <button
            className="tools-row tools-action"
            disabled={!running}
            onClick={() => {
              close();
              onFocus();
            }}
          >
            <Focus size={16} />
            <span>Режим фокуса</span>
          </button>
          <button className="tools-row tools-action" aria-expanded={sounds} onClick={() => setSounds((v) => !v)}>
            <Music size={16} />
            <span>Фоновые звуки</span>
            <ChevronDown size={16} className={sounds ? 'chev open' : 'chev'} />
          </button>
          {sounds && <AmbientPanel />}
        </div>
      )}
    </Popover>
  );
}
