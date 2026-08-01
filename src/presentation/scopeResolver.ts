/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Projects } from '../domain/repo/project.repo.js';
import type { Algorithms } from '../domain/repo/algorithm.repo.js';
import { Comparison } from '../domain/model/algorithm.model.js';
import type { Algorithm, Project } from '../domain/model/model.js';
import type { Config } from '../infrastructure/config/types.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { parsePercentage } from './parse.js';

export interface ResolvedDuplicateScope {
  project: Project;
  algorithm: Algorithm;
  minSimilarity: number;
  /** true if an explicit --threshold was given for an exact-comparison recipe. */
  thresholdIgnored: boolean;
}

/** Resolves project+recipe+algorithm scope for `duplicates` routes/CLI. */
export class ScopeResolver {
  constructor(
    private readonly projects: Projects,
    private readonly algorithms: Algorithms,
    private readonly config: Config,
  ) {}

  async resolveRecipeScope(projectId: string, recipe: string): Promise<{ project: Project; algorithm: Algorithm }> {
    const project = await this.projects.findById(projectId);

    if (!project) {
      throw NotFoundError.project(projectId);
    }

    if (!project.recipes.includes(recipe)) {
      throw ValidationError.recipeNotConfigured(recipe);
    }

    const algorithm = await this.algorithms.findByRecipe(recipe);

    if (!algorithm) {
      throw ValidationError.recipeNeverHashed(recipe);
    }

    return { project, algorithm };
  }

  /** resolveRecipeScope + threshold parsing + exact-comparison-ignores-threshold check. */
  async resolveDuplicateScope(
    projectId: string,
    recipe: string,
    rawThreshold: string | undefined,
  ): Promise<ResolvedDuplicateScope> {
    const { project, algorithm } = await this.resolveRecipeScope(projectId, recipe);
    const fallback = project.hammingThreshold ?? this.config.default_hamming_threshold;
    const minSimilarity = parsePercentage(rawThreshold, fallback);
    const thresholdIgnored = algorithm.comparison === Comparison.EXACT && rawThreshold !== undefined;

    return { project, algorithm, minSimilarity, thresholdIgnored };
  }
}
