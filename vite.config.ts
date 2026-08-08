/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  test: {
    globals: true,
    environment: 'node',
    // private-data/ holds real field files (gitignored). Diagnostics written
    // against them must never join the committed suite — `npm test` has to pass
    // on a clean checkout, where that folder doesn't exist.
    exclude: ['**/node_modules/**', '**/dist/**', 'private-data/**'],
  },
});
