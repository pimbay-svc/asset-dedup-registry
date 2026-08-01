import { describe, it, expect, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { ProjectHandlers } from '../../../../src/application/handler/project.handler.js';
import {
  CreateProject,
  UpdateProjectSettings,
  DeleteProject,
} from '../../../../src/application/command/project.command.js';
import type { ProjectWriter } from '../../../../src/application/writer/project.writer.js';
import type { Projects } from '../../../../src/domain/repo/project.repo.js';
import type { Project } from '../../../../src/domain/model/model.js';
import { AlreadyExistsError, ValidationError } from '../../../../src/domain/errors.js';
import type { ProjectRateLimitCache } from '../../../../src/infrastructure/rateLimit/projectRateLimitCache.js';

const PROJECT: Project = {
  id: 'p1',
  slug: 'demo',
  name: 'Demo',
  recipes: ['binary.sha256'],
  hammingThreshold: null,
  rateLimitPerMinute: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildHandlers(overrides: { writer?: Partial<ProjectWriter>; projects?: Partial<Projects> } = {}): {
  handlers: ProjectHandlers;
  writer: ProjectWriter;
  projects: Projects;
  createSpy: MockInstance;
  updateSettingsSpy: MockInstance;
  deleteByIdSpy: MockInstance;
  invalidateSpy: MockInstance;
} {
  const writer: ProjectWriter = {
    create: vi.fn().mockResolvedValue(PROJECT),
    updateSettings: vi.fn().mockResolvedValue(PROJECT),
    deleteById: vi.fn(),
    ...overrides.writer,
  };
  const projects: Projects = {
    findById: vi.fn(),
    findBySlug: vi.fn().mockResolvedValue(null),
    getBySlug: vi.fn(),
    list: vi.fn(),
    ...overrides.projects,
  };
  const createSpy = vi.spyOn(writer, 'create');
  const updateSettingsSpy = vi.spyOn(writer, 'updateSettings');
  const deleteByIdSpy = vi.spyOn(writer, 'deleteById');
  const rateLimitCache = { resolve: vi.fn(), invalidate: vi.fn() } as unknown as ProjectRateLimitCache;
  const invalidateSpy = vi.spyOn(rateLimitCache, 'invalidate');

  return {
    handlers: new ProjectHandlers(writer, projects, rateLimitCache),
    writer,
    projects,
    createSpy,
    updateSettingsSpy,
    deleteByIdSpy,
    invalidateSpy,
  };
}

describe('ProjectHandlers.create', () => {
  it('creates a project with deduped recipes', async () => {
    const { handlers, createSpy } = buildHandlers();

    await handlers.create(new CreateProject('demo', 'Demo', ['binary.sha256', 'binary.sha256'], null));

    expect(createSpy).toHaveBeenCalledWith({
      slug: 'demo',
      name: 'Demo',
      recipes: ['binary.sha256'],
      hammingThreshold: null,
      rateLimitPerMinute: null,
    });
  });

  it('rejects when a project with the same slug already exists', async () => {
    const { handlers } = buildHandlers({ projects: { findBySlug: vi.fn().mockResolvedValue(PROJECT) } });

    await expect(handlers.create(new CreateProject('demo', 'Demo', ['binary.sha256'], null))).rejects.toThrow(
      AlreadyExistsError,
    );
  });

  it('rejects recipes without a binary.* entry', async () => {
    const { handlers } = buildHandlers();

    await expect(handlers.create(new CreateProject('demo', 'Demo', ['image.phash16'], null))).rejects.toThrow(
      ValidationError,
    );
  });

  it('rejects an out-of-range hammingThreshold', async () => {
    const { handlers } = buildHandlers();

    await expect(handlers.create(new CreateProject('demo', 'Demo', ['binary.sha256'], 150))).rejects.toThrow(
      ValidationError,
    );
  });

  it('accepts a null hammingThreshold', async () => {
    const { handlers, createSpy } = buildHandlers();

    await handlers.create(new CreateProject('demo', 'Demo', ['binary.sha256'], null));

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ hammingThreshold: null }));
  });

  it('rejects a non-positive rateLimitPerMinute', async () => {
    const { handlers } = buildHandlers();

    await expect(handlers.create(new CreateProject('demo', 'Demo', ['binary.sha256'], null, -1))).rejects.toThrow(
      'rateLimitPerMinute must be a positive integer',
    );
  });

  it('accepts a null rateLimitPerMinute', async () => {
    const { handlers, createSpy } = buildHandlers();

    await handlers.create(new CreateProject('demo', 'Demo', ['binary.sha256'], null, null));

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ rateLimitPerMinute: null }));
  });

  it('passes a real hammingThreshold/rateLimitPerMinute through unchanged (not coerced to null)', async () => {
    const { handlers, createSpy } = buildHandlers();

    await handlers.create(new CreateProject('demo', 'Demo', ['binary.sha256'], 80, 50));

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ hammingThreshold: 80, rateLimitPerMinute: 50 }));
  });
});

describe('ProjectHandlers.updateSettings', () => {
  it('dedupes and validates recipes when provided', async () => {
    const { handlers, updateSettingsSpy } = buildHandlers();

    await handlers.updateSettings(new UpdateProjectSettings('p1', ['binary.sha256', 'binary.sha256']));

    expect(updateSettingsSpy).toHaveBeenCalledWith('p1', { recipes: ['binary.sha256'] });
  });

  it('rejects an empty recipes list', async () => {
    const { handlers } = buildHandlers();

    await expect(handlers.updateSettings(new UpdateProjectSettings('p1', []))).rejects.toThrow(
      'recipes must contain at least one recipe',
    );
  });

  it('leaves recipes untouched when not provided', async () => {
    const { handlers, updateSettingsSpy } = buildHandlers();

    await handlers.updateSettings(new UpdateProjectSettings('p1', undefined, 95));

    expect(updateSettingsSpy).toHaveBeenCalledWith('p1', { hammingThreshold: 95 });
  });

  it('rejects an invalid hammingThreshold', async () => {
    const { handlers } = buildHandlers();

    await expect(handlers.updateSettings(new UpdateProjectSettings('p1', undefined, -1))).rejects.toThrow(
      ValidationError,
    );
  });

  it('allows clearing hammingThreshold back to null', async () => {
    const { handlers, updateSettingsSpy } = buildHandlers();

    await handlers.updateSettings(new UpdateProjectSettings('p1', undefined, null));

    expect(updateSettingsSpy).toHaveBeenCalledWith('p1', { hammingThreshold: null });
  });

  it('validates and passes through rateLimitPerMinute when provided', async () => {
    const { handlers, updateSettingsSpy } = buildHandlers();

    await handlers.updateSettings(new UpdateProjectSettings('p1', undefined, undefined, 50));

    expect(updateSettingsSpy).toHaveBeenCalledWith('p1', { rateLimitPerMinute: 50 });
  });

  it('rejects a non-positive rateLimitPerMinute', async () => {
    const { handlers } = buildHandlers();

    await expect(handlers.updateSettings(new UpdateProjectSettings('p1', undefined, undefined, 0))).rejects.toThrow(
      'rateLimitPerMinute must be a positive integer',
    );
  });

  it('invalidates the rate-limit cache for this project', async () => {
    const { handlers, invalidateSpy } = buildHandlers();

    await handlers.updateSettings(new UpdateProjectSettings('p1', undefined, 95));

    expect(invalidateSpy).toHaveBeenCalledWith('p1');
  });
});

describe('ProjectHandlers.delete', () => {
  it('delegates to the writer', async () => {
    const { handlers, deleteByIdSpy } = buildHandlers();

    await handlers.delete(new DeleteProject('p1'));

    expect(deleteByIdSpy).toHaveBeenCalledWith('p1');
  });

  it('invalidates the rate-limit cache for this project', async () => {
    const { handlers, invalidateSpy } = buildHandlers();

    await handlers.delete(new DeleteProject('p1'));

    expect(invalidateSpy).toHaveBeenCalledWith('p1');
  });
});

describe('ProjectHandlers.asHandlers', () => {
  it('registers create, updateSettings, and delete against their command classes', () => {
    const { handlers } = buildHandlers();
    const registered = handlers.asHandlers();

    expect(registered.map((h) => h.commandClass)).toEqual([CreateProject, UpdateProjectSettings, DeleteProject]);
  });
});
