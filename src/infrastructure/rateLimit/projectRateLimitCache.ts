/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Projects } from '../../domain/repo/project.repo.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

interface CacheEntry {
  readonly value: number;
  readonly expiresAt: number;
}

/** Resolving a project's effective rate limit needs a DB lookup on every request otherwise — caches that
 * result per project for `ttlMs` (default 1 hour); `invalidate()` drops a single entry immediately,
 * called from `ProjectHandlers` after an update/delete. */
export class ProjectRateLimitCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly projects: Projects,
    private readonly defaultRateLimitPerMinute: number,
    private readonly ttlMs: number = ONE_HOUR_MS,
  ) {}

  async resolve(projectId: string): Promise<number> {
    const now = Date.now();
    const cached = this.entries.get(projectId);

    if (cached !== undefined && cached.expiresAt > now) {
      return cached.value;
    }

    const project = await this.projects.findById(projectId);
    const value = project?.rateLimitPerMinute ?? this.defaultRateLimitPerMinute;

    this.entries.set(projectId, { value, expiresAt: now + this.ttlMs });

    return value;
  }

  invalidate(projectId: string): void {
    this.entries.delete(projectId);
  }
}
