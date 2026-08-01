/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Logger } from 'pino';
import type { DatabaseConfig } from '../config/types.js';
import * as schema from './schema.js';
import { DbClientMessage } from './messages.js';

export type DbClient = PostgresJsDatabase<typeof schema> & { $client: Sql };
export type DbTransaction = Parameters<DbClient['transaction']>[0] extends (tx: infer T) => unknown ? T : never;
export type DbOrTx = PostgresJsDatabase<typeof schema> | DbTransaction;

const closingIntentionally = new WeakSet<Sql>();

/** The `onclose` decision, pulled out for direct unit testing: `closeDbClient` marks its own close as
 * intentional first, so only a genuinely unexpected disconnect reaches the logger. */
export function handlePoolClose(connId: unknown, client: Sql, intentionalCloses: WeakSet<Sql>, logger: Logger): void {
  if (intentionalCloses.has(client)) {
    return;
  }
  logger.debug({ connId }, DbClientMessage.POOL_CONNECTION_CLOSED);
}

export function createDbClient(config: DatabaseConfig, logger: Logger): DbClient {
  const client = postgres(config.url, {
    max: config.pool_size,
    idle_timeout: 30,
    connect_timeout: 5,
    onnotice: () => {
      /* empty */
    },
    onclose: (connId) => {
      handlePoolClose(connId, client, closingIntentionally, logger);
    },
  });

  return drizzle(client, { schema });
}

export async function closeDbClient(db: DbClient): Promise<void> {
  closingIntentionally.add(db.$client);
  await db.$client.end({ timeout: 5 });
}
