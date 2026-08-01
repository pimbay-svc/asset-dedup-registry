/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Identity } from './model/asset.model.js';

/** `id=..., path=...` — omitting whichever side of the identity is null. Used only for error messages. */
function formatIdentity(identity: Identity): string {
  const parts: string[] = [];

  if (identity.id !== null) {
    parts.push(`id=${identity.id}`);
  }

  if (identity.path !== null) {
    parts.push(`path=${identity.path}`);
  }

  return parts.join(', ');
}

export abstract class AssetDedupRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** No api_client matched the bearer token, or it was revoked. */
export class UnauthorizedError extends AssetDedupRegistryError {
  private constructor(message: string) {
    super(message);
  }

  static missingAuthorizationHeader(): UnauthorizedError {
    return new UnauthorizedError('missing or malformed Authorization header');
  }

  static emptyApiKey(): UnauthorizedError {
    return new UnauthorizedError('empty API key');
  }

  static invalidApiKey(): UnauthorizedError {
    return new UnauthorizedError('invalid or revoked API key');
  }
}

/** The api_client is valid but lacks the scope required for this endpoint. */
export class ForbiddenError extends AssetDedupRegistryError {
  private constructor(message: string) {
    super(message);
  }

  static missingScope(scope: string): ForbiddenError {
    return new ForbiddenError(`this API key does not have the '${scope}' scope`);
  }
}

/** Only constructible via the static factories below. */
export class ValidationError extends AssetDedupRegistryError {
  private constructor(message: string) {
    super(message);
  }

  static notPositiveInteger(fieldName: string): ValidationError {
    return new ValidationError(`${fieldName} must be a positive integer`);
  }

  static percentageOutOfRange(fieldName: string): ValidationError {
    return new ValidationError(`${fieldName} must be a number between 0 and 100`);
  }

  static exceedsMaximum(fieldName: string, max: number): ValidationError {
    return new ValidationError(`${fieldName} must not exceed ${String(max)}`);
  }

  static recipeNotConfigured(recipe: string): ValidationError {
    return new ValidationError(`recipe '${recipe}' is not configured for this project`);
  }

  static recipeNeverHashed(recipe: string): ValidationError {
    return new ValidationError(`recipe '${recipe}' has not been used to hash any asset yet`);
  }

  static recipesEmpty(): ValidationError {
    return new ValidationError('recipes must contain at least one recipe');
  }

  static recipesMissingBinary(): ValidationError {
    return new ValidationError("recipes must contain at least one 'binary.*' recipe");
  }

  static identityEmpty(): ValidationError {
    return new ValidationError('identity must have at least one of id or path set');
  }

  static tooManyDuplicateEdges(edgeCount: number): ValidationError {
    return new ValidationError(
      `too many duplicate edges (${String(edgeCount)}) to compute clusters in one request — ` +
        `raise minSimilarity to narrow the graph, or use /duplicates/ranking for a ranked view instead`,
    );
  }

  /** Should not happen in practice — see MAX_PROPAGATION_ITERATIONS in cluster.repository.ts. */
  static clusterComputationDidNotConverge(algorithmId: number, threshold: number): ValidationError {
    return new ValidationError(
      `cluster computation for algorithm ${String(algorithmId)} at threshold ${String(threshold)}% did not ` +
        `converge — this indicates a pathologically large-diameter duplicate graph; please report this`,
    );
  }

  /** The pinned `generation` (from an earlier page) no longer exists — never computed, or aged out of the
   * cache's retention window before this later page was requested. No snapshot left to read from. */
  static clusterGenerationExpired(generation: number): ValidationError {
    return new ValidationError(
      `cluster generation ${String(generation)} is no longer available — the underlying data has since ` +
        `changed and that snapshot was cleaned up; restart pagination from page 1 without a generation ` +
        `parameter to get a current one`,
    );
  }

  /** core rejected our request with a 400 — its message is relayed as-is. */
  static fromCore(message: string): ValidationError {
    return new ValidationError(message);
  }
}

/** asset-dedup-core did not respond, timed out, or returned a malformed/unexpected response. */
export class CoreUnavailableError extends AssetDedupRegistryError {
  private constructor(message: string) {
    super(message);
  }

  static emptyHashResponse(): CoreUnavailableError {
    return new CoreUnavailableError('core returned an empty /hash response');
  }

  static incompleteAlgorithmsResponse(): CoreUnavailableError {
    return new CoreUnavailableError('core returned an incomplete /algorithms response');
  }

  static malformedHashResult(recipe: string): CoreUnavailableError {
    return new CoreUnavailableError(`core /hash result for recipe '${recipe}' has neither 'hashes' nor 'vectors'`);
  }

  static unreachable(cause: string): CoreUnavailableError {
    return new CoreUnavailableError(`core unreachable: ${cause}`);
  }

  /** core responded with a non-400/422 error status — its message (or a fallback) is relayed as-is. */
  static fromCoreResponse(message: string): CoreUnavailableError {
    return new CoreUnavailableError(message);
  }
}

/** core rejected this specific asset (corrupt file, a subservice item error) — its 422. */
export class AssetProcessingError extends AssetDedupRegistryError {
  private constructor(message: string) {
    super(message);
  }

  /** core rejected our request with a 422 — its message is relayed as-is. */
  static fromCore(message: string): AssetProcessingError {
    return new AssetProcessingError(message);
  }
}

/** The referenced asset/project was not found. */
export class NotFoundError extends AssetDedupRegistryError {
  private constructor(message: string) {
    super(message);
  }

  static project(identifier: string): NotFoundError {
    return new NotFoundError(`project '${identifier}' not found`);
  }

  static asset(identity: Identity): NotFoundError {
    return new NotFoundError(`asset '${formatIdentity(identity)}' not found`);
  }

  static apiClient(id: string): NotFoundError {
    return new NotFoundError(`API client '${id}' not found (or already revoked)`);
  }
}

/** A record with the same unique key (project slug, api-client name, ...) already exists. */
export class AlreadyExistsError extends AssetDedupRegistryError {
  private constructor(message: string) {
    super(message);
  }

  static project(slug: string): AlreadyExistsError {
    return new AlreadyExistsError(`project with slug '${slug}' already exists`);
  }

  static apiClient(name: string): AlreadyExistsError {
    return new AlreadyExistsError(`API client '${name}' already exists for this project`);
  }

  /** An identity patch matched two different existing assets — one via `id`, a different one via `path`. */
  static asset(identity: Identity): AlreadyExistsError {
    return new AlreadyExistsError(
      `identity '${formatIdentity(identity)}' matches two different existing assets (one via id, another via path)`,
    );
  }
}

/** core reports a different comparison for a recipe than what's already stored — a contract violation. */
export class AlgorithmContractError extends AssetDedupRegistryError {
  private constructor(message: string) {
    super(message);
  }

  static recipeNotReportedByCore(recipe: string): AlgorithmContractError {
    return new AlgorithmContractError(`core does not report a recipe named '${recipe}' via GET /algorithms`);
  }

  static comparisonMismatch(recipe: string, coreComparison: string, storedComparison: string): AlgorithmContractError {
    return new AlgorithmContractError(
      `core now reports recipe '${recipe}' as comparison=${coreComparison}, ` +
        `but it is already stored as comparison=${storedComparison}`,
    );
  }
}

/** core returned `vectors` instead of `hashes` — cosine recipes are not supported yet (asset_vector is schema-only). */
export class UnsupportedRecipeError extends AssetDedupRegistryError {
  private constructor(message: string) {
    super(message);
  }

  static vectorRecipe(recipe: string): UnsupportedRecipeError {
    return new UnsupportedRecipeError(
      `recipe '${recipe}' returned vectors — cosine/vector recipes aren't implemented in registry yet`,
    );
  }
}
