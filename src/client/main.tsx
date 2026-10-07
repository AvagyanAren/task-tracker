import '@fontsource-variable/manrope';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Installable app + offline shell. Only in the built app, never in dev or tests.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
