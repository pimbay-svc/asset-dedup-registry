import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildContainer } from '../../../src/infrastructure/container.js';
import { CreateProject } from '../../../src/application/command/project.command.js';
import { loadEnv } from '../../../src/infrastructure/env/env.js';
import type { Config } from '../../../src/infrastructure/config/types.js';
import { useTestDb } from '../../helpers/db.js';

const originalDatabaseUrl = process.env.DATABASE_URL;

const CONFIG: Config = {
  core_base_url: 'http://core:3000',
  core_timeout_ms: 5000,
  default_hamming_threshold: 90,
  default_rate_limit_per_minute: 300,
  database: { pool_size: 5 },
};

const ENV = loadEnv({ NODE_ENV: 'test' });

describe('buildContainer', () => {
  const { connectionUri } = useTestDb();

  beforeAll(() => {
    process.env.DATABASE_URL = connectionUri();
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('wires the full CQRS chain end to end: create a project via the real container', async () => {
    const { container, cleanup } = buildContainer(ENV, CONFIG);

    try {
      const project = await container.cradle.commandGateway.dispatch(
        new CreateProject('demo', 'Demo', ['binary.sha256'], null),
      );

      expect(project.slug).toBe('demo');
      await expect(container.cradle.projects.findBySlug('demo')).resolves.toMatchObject({ id: project.id });
    } finally {
      await cleanup();
    }
  });

  it('resolves every registered cradle key without throwing', async () => {
    const { container, cleanup } = buildContainer(ENV, CONFIG);

    try {
      expect(() => container.cradle.commandGateway).not.toThrow();
      expect(() => container.cradle.assetHandlers).not.toThrow();
      expect(() => container.cradle.clusters).not.toThrow();
      expect(() => container.cradle.clustersSearch).not.toThrow();
      expect(() => container.cradle.projectStatsService).not.toThrow();
      expect(() => container.cradle.scopeResolver).not.toThrow();
      expect(() => container.cradle.algorithmService).not.toThrow();
      expect(container.cradle.config.default_hamming_threshold).toBe(90);
    } finally {
      await cleanup();
    }
  });
});
