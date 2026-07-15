import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        // Branch/function rates are structurally depressed by parser code
        // that executes inside the browser (V8 coverage cannot see it),
        // so the global gate is on lines and statements.
        lines: 80,
        statements: 80,
        'src/safety/**/*.ts': {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
      },
    },
  },
});
