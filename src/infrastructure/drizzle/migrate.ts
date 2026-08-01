/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadConfig, resolveConfigPath, resolveDatabaseConfig } from '../config/config.js';
import { MigrateMessage } from './messages.js';

async function main(): Promise<void> {
  const config = loadConfig(resolveConfigPath());
  const dbConfig = resolveDatabaseConfig(config);

  const client = postgres(dbConfig.url, { max: 1 });

  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './migration' });

    console.log(MigrateMessage.ALL_MIGRATIONS_APPLIED);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(MigrateMessage.FATAL, err);
  process.exit(1);
});
