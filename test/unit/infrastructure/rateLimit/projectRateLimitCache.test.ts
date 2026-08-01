import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { ProjectRateLimitCache } from '../../../../src/infrastructure/rateLimit/projectRateLimitCache.js';
import type { Projects } from '../../../../src/domain/repo/project.repo.js';
import type { Project } from '../../../../src/domain/model/model.js';

afterEach(() => {
  vi.useRealTimers();
});

function buildProjects(rateLimitPerMinute: number | null): { projects: Projects; findByIdSpy: MockInstance } {
  const findByIdSpy = vi.fn().mockResolvedValue({ id: 'p1', rateLimitPerMinute } satisfies Partial<Project>);

  return {
    projects: { findById: findByIdSpy, findBySlug: vi.fn(), getBySlug: vi.fn(), list: vi.fn() },
    findByIdSpy,
  };
}

describe('ProjectRateLimitCache', () => {
  it('returns the project-configured limit when set', async () => {
    const { projects } = buildProjects(50);
    const cache = new ProjectRateLimitCache(projects, 300);

    await expect(cache.resolve('p1')).resolves.toBe(50);
  });

  it('falls back to the default when the project has no override', async () => {
    const { projects } = buildProjects(null);
    const cache = new ProjectRateLimitCache(projects, 300);

    await expect(cache.resolve('p1')).resolves.toBe(300);
  });

  it('falls back to the default when the project is not found', async () => {
    const projects: Projects = {
      findById: vi.fn().mockResolvedValue(null),
      findBySlug: vi.fn(),
      getBySlug: vi.fn(),
      list: vi.fn(),
    };
    const cache = new ProjectRateLimitCache(projects, 300);

    await expect(cache.resolve('missing')).resolves.toBe(300);
  });

  it('does not re-query on a second call within the TTL', async () => {
    const { projects, findByIdSpy } = buildProjects(50);
    const cache = new ProjectRateLimitCache(projects, 300);

    await cache.resolve('p1');
    await cache.resolve('p1');

    expect(findByIdSpy).toHaveBeenCalledTimes(1);
  });

  it('re-queries once the TTL has expired', async () => {
    vi.useFakeTimers();
    const { projects, findByIdSpy } = buildProjects(50);
    const cache = new ProjectRateLimitCache(projects, 300, 1000);

    await cache.resolve('p1');
    vi.advanceTimersByTime(1001);
    await cache.resolve('p1');

    expect(findByIdSpy).toHaveBeenCalledTimes(2);
  });

  it('treats the cache as expired at the exact TTL boundary (not one tick early)', async () => {
    vi.useFakeTimers();
    const { projects, findByIdSpy } = buildProjects(50);
    const cache = new ProjectRateLimitCache(projects, 300, 1000);

    await cache.resolve('p1');
    vi.advanceTimersByTime(1000);
    await cache.resolve('p1');

    expect(findByIdSpy).toHaveBeenCalledTimes(2);
  });

  it('invalidate() forces the next resolve() to re-query', async () => {
    const { projects, findByIdSpy } = buildProjects(50);
    const cache = new ProjectRateLimitCache(projects, 300);

    await cache.resolve('p1');
    cache.invalidate('p1');
    await cache.resolve('p1');

    expect(findByIdSpy).toHaveBeenCalledTimes(2);
  });

  it('invalidate() only clears the given project, not others', async () => {
    const { projects, findByIdSpy } = buildProjects(50);
    const cache = new ProjectRateLimitCache(projects, 300);

    await cache.resolve('p1');
    await cache.resolve('p2');
    cache.invalidate('p1');
    await cache.resolve('p1');
    await cache.resolve('p2');

    expect(findByIdSpy).toHaveBeenCalledTimes(3);
  });
});
