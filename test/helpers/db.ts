import { beforeAll, afterAll, afterEach, inject } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { createDbClient } from '../../src/infrastructure/drizzle/client.js';
import type { DbClient } from '../../src/infrastructure/drizzle/client.js';

// Order doesn't matter for TRUNCATE ... CASCADE, but listed leaf-first for readability.
const ALL_TABLES = ['asset_hash_duplicate', 'asset_hash', 'algorithm', 'asset', 'api_client', 'project'] as const;

export interface TestDb {
  db: () => DbClient;
  connectionUri: () => string;
}

/** Swaps the connection URI's database name only, keeping host/port/user/password from the shared container. */
function withDatabase(uri: string, dbName: string): string {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;

  return url.toString();
}

export function useTestDb(): TestDb {
  let client!: DbClient;
  let uri!: string;
  let dbName!: string;
  let adminUri!: string;

  beforeAll(async () => {
    adminUri = inject('sharedDbUri');
    dbName = `test_${randomUUID().replaceAll('-', '')}`;

    const admin = createDbClient({ url: adminUri, pool_size: 1 }, pino({ level: 'silent' }));
    await admin.execute(sql.raw(`CREATE DATABASE "${dbName}"`));
    await admin.$client.end({ timeout: 5 });

    uri = withDatabase(adminUri, dbName);
    client = createDbClient({ url: uri, pool_size: 5 }, pino({ level: 'silent' }));

    await migrate(client, { migrationsFolder: './migration' });
  }, 30_000);

  afterEach(async () => {
    await client.execute(sql`TRUNCATE TABLE ${sql.raw(ALL_TABLES.join(', '))} RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await client.$client.end({ timeout: 5 });

    const admin = createDbClient({ url: adminUri, pool_size: 1 }, pino({ level: 'silent' }));
    await admin.execute(sql.raw(`DROP DATABASE IF EXISTS "${dbName}"`));
    await admin.$client.end({ timeout: 5 });
  });

  return {
    db: () => client,
    connectionUri: () => uri,
  };
}
