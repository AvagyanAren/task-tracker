import { resolve } from 'node:path';
import { createApp } from './app.js';
import { Store } from './store.js';

const file = resolve(process.env.TRACKER_DATA || 'data/tracker.json');
const port = Number(process.env.PORT) || 4321;

const app = createApp(new Store(file));
// Only this computer can reach it: the data is personal.
app.listen(port, '127.0.0.1', () => {
  console.log(`Трекер времени: http://localhost:${port}`);
  console.log(`Данные: ${file}`);
});
