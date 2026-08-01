import { defineConfig, coverageConfigDefaults, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
    },
    testTimeout: 10_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
    globalSetup: ['./test/helpers/globalDbSetup.ts'],

    exclude: [...configDefaults.exclude, 'var/**'],

    coverage: {
      exclude: [
        ...coverageConfigDefaults.exclude,
        '**/var/**',
        'src/server.ts',
        'src/presentation/cli/cli.ts',
        'src/infrastructure/drizzle/client.ts',
        'src/infrastructure/drizzle/migrate.ts',
        'src/infrastructure/drizzle/schema/**',
        'src/infrastructure/drizzle/schema.ts',
      ],
      include: ['src/**'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'var/reports/coverage',
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
