/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { ValidationError } from '../errors.js';
import { isValidPercentage } from './validation.js';

/** A project's `recipes` list must always include at least one `binary.*` recipe — core itself falls
 * back to that wildcard group when no other configured recipe applies, so a project without one could
 * end up with assets core silently declines to hash at all. */
export function assertValidRecipes(recipes: string[]): void {
  if (recipes.length === 0) {
    throw ValidationError.recipesEmpty();
  }

  if (!recipes.some((recipe) => recipe.startsWith('binary.'))) {
    throw ValidationError.recipesMissingBinary();
  }
}

/** `null` means "fall back to the registry-wide config default" and is always valid. */
export function assertValidHammingThreshold(value: number | null): void {
  if (value === null) {
    return;
  }

  if (!isValidPercentage(value)) {
    throw ValidationError.percentageOutOfRange('hammingThreshold');
  }
}

/** `null` means "fall back to the registry-wide config default" and is always valid. */
export function assertValidRateLimitPerMinute(value: number | null): void {
  if (value === null) {
    return;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw ValidationError.notPositiveInteger('rateLimitPerMinute');
  }
}
