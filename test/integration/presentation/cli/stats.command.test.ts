import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { buildStatsCommand } from '../../../../src/presentation/cli/command/stats.command.js';
import { buildFakeCradle } from '../../../helpers/fakeCradle.js';
import type { Project } from '../../../../src/domain/model/model.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockExit(): MockInstance<(code?: number | string | null) => never> {
  return vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    slug: 'demo',
    name: 'Demo',
    recipes: ['binary.sha256'],
    hammingThreshold: null,
    rateLimitPerMinute: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('stats projects', () => {
  it('prints one row per project with asset and duplicate-pair counts', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeProject({ id: 'p1', slug: 'demo', name: 'Demo' }),
    ]);
    const getOverviewSpy = vi.spyOn(cradle.projectStatsService, 'getOverview').mockResolvedValue({
      slug: 'demo',
      name: 'Demo',
      assets: 5,
      duplicatePairs: 2,
    });

    const command = buildStatsCommand(() => cradle);
    await command.parseAsync(['projects'], { from: 'user' });

    expect(getOverviewSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', slug: 'demo' }));
    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('demo');
    expect(output).toContain('5');
    expect(output).toContain('2');
  });

  it('prints JSON when --json is passed, with real numbers not strings', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeProject({ id: 'p1', slug: 'demo', name: 'Demo' }),
    ]);
    (cradle.projectStatsService.getOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      slug: 'demo',
      name: 'Demo',
      assets: 5,
      duplicatePairs: 2,
    });

    const command = buildStatsCommand(() => cradle);
    await command.parseAsync(['projects', '--json'], { from: 'user' });

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(JSON.parse(output)).toEqual([{ slug: 'demo', name: 'Demo', assets: 5, duplicate_pairs: 2 }]);
  });

  it('prints "(no results)" when there are no projects', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const command = buildStatsCommand(() => cradle);
    await command.parseAsync(['projects'], { from: 'user' });

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('(no results)');
  });

  it('prints an error and exits on failure', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));

    const command = buildStatsCommand(() => cradle);
    await command.parseAsync(['projects'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
