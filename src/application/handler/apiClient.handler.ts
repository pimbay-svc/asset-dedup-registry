/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { randomBytes } from 'node:crypto';
import type { CommandHandler } from '../command.gateway.js';
import { CreateApiClient, type CreateApiClientResult, RevokeApiClient } from '../command/apiClient.command.js';
import { sha256Hex } from '../../infrastructure/crypto/credentials.js';
import type { ApiClientWriter } from '../writer/apiClient.writer.js';
import type { ApiClients } from '../../domain/repo/apiClient.repo.js';
import { AlreadyExistsError } from '../../domain/errors.js';

export class ApiClientHandlers {
  constructor(
    private readonly apiClientWriter: ApiClientWriter,
    private readonly apiClients: ApiClients,
  ) {}

  async create(command: CreateApiClient): Promise<CreateApiClientResult> {
    if ((await this.apiClients.findByProjectAndName(command.projectId, command.name)) !== null) {
      throw AlreadyExistsError.apiClient(command.name);
    }

    const rawKey = randomBytes(32).toString('hex');
    const keyHash = sha256Hex(rawKey);
    const apiClient = await this.apiClientWriter.create({
      projectId: command.projectId,
      name: command.name,
      keyHash,
      scopes: command.scopes,
    });

    return { apiClient, rawKey };
  }

  async revoke(command: RevokeApiClient): Promise<void> {
    await this.apiClientWriter.revoke(command.id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asHandlers(): CommandHandler<any, any>[] {
    const create: CommandHandler<CreateApiClient, CreateApiClientResult> = {
      commandClass: CreateApiClient,
      execute: this.create.bind(this),
    };
    const revoke: CommandHandler<RevokeApiClient, void> = {
      commandClass: RevokeApiClient,
      execute: this.revoke.bind(this),
    };

    return [create, revoke];
  }
}
