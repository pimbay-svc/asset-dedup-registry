// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'npm',
  testRunner: 'vitest',

  ignorePatterns: ['dist/**', 'var/**'],
  mutate: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/application/errors.ts',
    '!src/domain/errors.ts',
    '!src/infrastructure/config/errors.ts',
    '!src/infrastructure/drizzle/migrate.ts',
    '!src/infrastructure/drizzle/client.ts',
    '!src/infrastructure/drizzle/schema/**',
    '!src/infrastructure/env/errors.ts',
    '!src/presentation/cli/cli.ts',
    '!src/presentation/cli/command/**',
    '!src/presentation/cli/output.ts',
    '!src/presentation/http/server.ts',
    '!src/presentation/http/route/**',
  ],

  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',

  coverageAnalysis: 'perTest',
  ignoreStatic: true,

  /** Snapshot is regenerated manually (`npm run test:mutation:snapshot`) and committed — CI just consumes it,
   * so a stale/missing file falls back to a full run rather than failing. Deliberately outside `var/`
   * (fully gitignored/ephemeral): this file must survive across commits to do anything. */
  incremental: true,
  incrementalFile: '.stryker/incremental.json',

  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },

  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: {
    fileName: 'var/reports/mutation/index.html',
  },
  jsonReporter: {
    fileName: 'var/reports/mutation/report.json',
  },

  tempDirName: 'var/tmp/stryker',
};

export default config;
