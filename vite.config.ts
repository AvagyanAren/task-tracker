import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: { outDir: '../../dist/public', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4321' } },
  test: { root: '.', include: ['src/**/*.test.{ts,tsx}'], testTimeout: 20000 }
});
