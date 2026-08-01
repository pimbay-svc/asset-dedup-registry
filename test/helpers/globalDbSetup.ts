/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { TestProject } from 'vitest/node';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

declare module 'vitest' {
  export interface ProvidedContext {
    sharedDbUri: string;
  }
}

export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  project.provide('sharedDbUri', container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}
