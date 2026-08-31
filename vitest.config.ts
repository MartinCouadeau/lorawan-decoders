import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/core/types.ts'],
      thresholds: { lines: 95, functions: 95, branches: 88, statements: 95 },
    },
  },
});
