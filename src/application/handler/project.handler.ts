/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { CommandHandler } from '../command.gateway.js';
import type { Project } from '../../domain/model/model.js';
import { CreateProject, UpdateProjectSettings, DeleteProject } from '../command/project.command.js';
import type { ProjectWriter } from '../writer/project.writer.js';
import type { Projects } from '../../domain/repo/project.repo.js';
import {
  assertValidRecipes,
  assertValidHammingThreshold,
  assertValidRateLimitPerMinute,
} from '../../domain/validation/project.validation.js';
import { AlreadyExistsError } from '../../domain/errors.js';
import type { ProjectRateLimitCache } from '../../infrastructure/rateLimit/projectRateLimitCache.js';

function dedupeRecipes(recipes: string[]): string[] {
  return [...new Set(recipes)];
}

export class ProjectHandlers {
  constructor(
    private readonly projectWriter: ProjectWriter,
    private readonly projects: Projects,
    private readonly projectRateLimitCache: ProjectRateLimitCache,
  ) {}

  async create(command: CreateProject): Promise<Project> {
    const recipes = dedupeRecipes(command.recipes);

    assertValidRecipes(recipes);
    assertValidHammingThreshold(command.hammingThreshold ?? null);
    assertValidRateLimitPerMinute(command.rateLimitPerMinute ?? null);

    if ((await this.projects.findBySlug(command.slug)) !== null) {
      throw AlreadyExistsError.project(command.slug);
    }

    return this.projectWriter.create({
      slug: command.slug,
      name: command.name,
      recipes,
      hammingThreshold: command.hammingThreshold ?? null,
      rateLimitPerMinute: command.rateLimitPerMinute ?? null,
    });
  }

  async updateSettings(command: UpdateProjectSettings): Promise<Project> {
    const recipes = command.recipes !== undefined ? dedupeRecipes(command.recipes) : undefined;

    if (recipes !== undefined) {
      assertValidRecipes(recipes);
    }

    if (command.hammingThreshold !== undefined) {
      assertValidHammingThreshold(command.hammingThreshold);
    }

    if (command.rateLimitPerMinute !== undefined) {
      assertValidRateLimitPerMinute(command.rateLimitPerMinute);
    }

    const project = await this.projectWriter.updateSettings(command.id, {
      ...(recipes !== undefined && { recipes }),
      ...(command.hammingThreshold !== undefined && { hammingThreshold: command.hammingThreshold }),
      ...(command.rateLimitPerMinute !== undefined && { rateLimitPerMinute: command.rateLimitPerMinute }),
    });

    this.projectRateLimitCache.invalidate(command.id);

    return project;
  }

  async delete(command: DeleteProject): Promise<void> {
    await this.projectWriter.deleteById(command.id);
    this.projectRateLimitCache.invalidate(command.id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asHandlers(): CommandHandler<any, any>[] {
    const create: CommandHandler<CreateProject, Project> = {
      commandClass: CreateProject,
      execute: this.create.bind(this),
    };
    const updateSettings: CommandHandler<UpdateProjectSettings, Project> = {
      commandClass: UpdateProjectSettings,
      execute: this.updateSettings.bind(this),
    };
    const del: CommandHandler<DeleteProject, void> = {
      commandClass: DeleteProject,
      execute: this.delete.bind(this),
    };

    return [create, updateSettings, del];
  }
}
