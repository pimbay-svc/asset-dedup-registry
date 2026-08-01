/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Command } from '../command.gateway.js';
import type { Project } from '../../domain/model/model.js';

export class CreateProject implements Command<Project> {
  declare readonly _resultType?: () => Project;

  constructor(
    public readonly slug: string,
    public readonly name: string,
    public readonly recipes: string[],
    public readonly hammingThreshold?: number | null,
    public readonly rateLimitPerMinute?: number | null,
  ) {}
}

export class UpdateProjectSettings implements Command<Project> {
  declare readonly _resultType?: () => Project;

  constructor(
    public readonly id: string,
    public readonly recipes?: string[],
    public readonly hammingThreshold?: number | null,
    public readonly rateLimitPerMinute?: number | null,
  ) {}
}

export class DeleteProject implements Command<void> {
  declare readonly _resultType?: () => void;

  constructor(public readonly id: string) {}
}
