import { Calendar, List, Table } from '../icons.js';
import { useApp } from '../ctx.js';
import { Segmented } from '../ui.js';
import type { TimerView } from '../settings.js';
import type { PomoApi } from '../usePomodoro.js';
import { CalendarView } from './CalendarView.js';
import { EntryList } from './EntryList.js';
import { SidePanel } from './SidePanel.js';
import { TimerBar } from './TimerBar.js';
import { TimesheetView } from './TimesheetView.js';

export function TimerPage({ pomo, onFocus }: { pomo: PomoApi; onFocus: () => void }) {
  const { settings, setSettings } = useApp();
  return (
    <div className="timer-page">
      <TimerBar pomo={pomo} onFocus={onFocus} />
      <div className="timer-layout">
        <div className="timer-main">
          <div className="row between view-switch">
            <h2>Записи</h2>
            <Segmented<TimerView>
              label="Вид"
              value={settings.view}
              onChange={(view) => setSettings({ view })}
              options={[
                { value: 'list', label: <><List size={15} /> Список</> },
                { value: 'calendar', label: <><Calendar size={15} /> Календарь</> },
                { value: 'timesheet', label: <><Table size={15} /> Timesheet</> }
              ]}
            />
          </div>
          {settings.view === 'list' && <EntryList />}
          {settings.view === 'calendar' && <CalendarView />}
          {settings.view === 'timesheet' && <TimesheetView />}
        </div>
        {settings.view === 'list' && <SidePanel />}
      </div>
    </div>
  );
}
