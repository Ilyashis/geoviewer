/** Отдельный конфиг для стенда на открытых данных FORCE 2020 (папка datasets/ — gitignore). */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: process.cwd(),
    include: ['bench/force2020/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 120_000,
  },
});
