import { Dialog, Kbd } from '../ui.js';

const KEYS: Array<[string, string]> = [
  ['N', 'Новая запись: запустить таймер'],
  ['S', 'Остановить таймер'],
  ['M', 'Добавить время вручную'],
  ['C', 'Продолжить последнюю запись'],
  ['?', 'Показать эту подсказку']
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Горячие клавиши" onClose={onClose}>
      <div className="keys">
        {KEYS.map(([k, d]) => (
          <div key={k} className="keys-row">
            <Kbd>{k}</Kbd>
            <span>{d}</span>
          </div>
        ))}
      </div>
      <p className="hint">Работают, когда курсор не в поле ввода. Подходят и русская, и английская раскладки.</p>
      <h3>В описании записи</h3>
      <div className="keys">
        <div className="keys-row">
          <Kbd>@</Kbd>
          <span>выбрать проект</span>
        </div>
        <div className="keys-row">
          <Kbd>#</Kbd>
          <span>добавить тег</span>
        </div>
      </div>
    </Dialog>
  );
}
