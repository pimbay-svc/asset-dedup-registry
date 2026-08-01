/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { apiClientTable } from '../schema/apiClient.schema.js';
import type { ApiClient, NewApiClient } from '../../../domain/model/model.js';
import type { ApiClients } from '../../../domain/repo/apiClient.repo.js';
import type { ApiClientWriter } from '../../../application/writer/apiClient.writer.js';
import { AlreadyExistsError, NotFoundError } from '../../../domain/errors.js';
import { isUniqueError } from '../errors.js';

export class DrizzleApiClientRepository implements ApiClients, ApiClientWriter {
  constructor(private readonly db: DbClient) {}

  async create(params: NewApiClient): Promise<ApiClient> {
    try {
      const [row] = await this.db.insert(apiClientTable).values(params).returning();

      /* v8 ignore next 3 -- unreachable: plain INSERT...RETURNING always returns the row or throws */
      if (row === undefined) {
        // Stryker disable next-line all: unreachable in practice — guards against the DB driver returning zero rows from an insert/upsert that Postgres guarantees returns exactly one; kept as a defensive invariant check, not a code path any test can trigger honestly.
        throw new Error('API client insert returned no rows');
      }

      return row;
    } catch (err) {
      if (isUniqueError(err)) {
        throw AlreadyExistsError.apiClient(params.name);
      }

      throw err;
    }
  }

  async findByProjectAndName(projectId: string, name: string): Promise<ApiClient | null> {
    const [row] = await this.db
      .select()
      .from(apiClientTable)
      .where(
        and(eq(apiClientTable.projectId, projectId), eq(apiClientTable.name, name), isNull(apiClientTable.revokedAt)),
      )
      .limit(1);

    return row ?? null;
  }

  async findByKeyHash(keyHash: string): Promise<ApiClient | null> {
    const [row] = await this.db
      .select()
      .from(apiClientTable)
      .where(and(eq(apiClientTable.keyHash, keyHash), isNull(apiClientTable.revokedAt)))
      .limit(1);

    return row ?? null;
  }

  async revoke(id: string): Promise<void> {
    const [row] = await this.db
      .update(apiClientTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiClientTable.id, id), isNull(apiClientTable.revokedAt)))
      .returning({ id: apiClientTable.id });

    if (row === undefined) {
      throw NotFoundError.apiClient(id);
    }
  }

  async listByProject(projectId: string): Promise<ApiClient[]> {
    return this.db
      .select()
      .from(apiClientTable)
      .where(eq(apiClientTable.projectId, projectId))
      .orderBy(apiClientTable.createdAt);
  }
}
