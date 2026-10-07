import { entrySeconds } from '../../shared/report.js';
import { formatClock } from '../../shared/time.js';
import type { Entry } from '../../shared/types.js';
import { useApp } from '../ctx.js';
import { Square } from '../icons.js';
import { ProjectDot } from '../ui.js';

/** Running timer, visible on every screen: tap the text to go to the timer, the square to stop it. */
export function MiniTimer({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const { state, now, stopTimer } = useApp();
  const project = state.projects.find((p) => p.id === entry.projectId);
  return (
    <div className="minitimer" role="status">
      <button className="minitimer-open" onClick={onOpen} aria-label="Открыть таймер">
        <i className="minitimer-pulse" />
        <span className="minitimer-text">
          <strong>{entry.description || '(без названия)'}</strong>
          {project && (
            <small>
              <ProjectDot color={project.color} size={7} /> {project.name}
            </small>
          )}
        </span>
        <span className="minitimer-clock">{formatClock(entrySeconds(entry, now))}</span>
      </button>
      <button className="btn stop round minitimer-stop" onClick={() => stopTimer()} aria-label="Стоп">
        <Square size={16} solid />
      </button>
    </div>
  );
}
