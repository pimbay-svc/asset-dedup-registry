import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { buildProjectCommand } from '../../../../src/presentation/cli/command/project.command.js';
import { buildFakeCradle } from '../../../helpers/fakeCradle.js';
import {
  CreateProject,
  UpdateProjectSettings,
  DeleteProject,
} from '../../../../src/application/command/project.command.js';
import type { Project } from '../../../../src/domain/model/model.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockExit(): MockInstance<(code?: number | string | null) => never> {
  return vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
}

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

describe('project create', () => {
  it('dispatches CreateProject with parsed recipes and prints a table row', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['create', '--slug', 'demo', '--name', 'Demo', '--recipes', 'binary.sha256'], {
      from: 'user',
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'demo', name: 'Demo', recipes: ['binary.sha256'], hammingThreshold: null }),
    );
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CreateProject));
    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('demo');
  });

  it('splits comma-separated recipes and trims whitespace', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(
      ['create', '--slug', 'demo', '--name', 'Demo', '--recipes', 'binary.sha256, image.phash16 '],
      { from: 'user' },
    );

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ recipes: ['binary.sha256', 'image.phash16'] }));
  });

  it('parses --hamming-threshold', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(
      ['create', '--slug', 'demo', '--name', 'Demo', '--recipes', 'binary.sha256', '--hamming-threshold', '95'],
      { from: 'user' },
    );

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ hammingThreshold: 95 }));
  });

  it('parses --rate-limit', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(
      ['create', '--slug', 'demo', '--name', 'Demo', '--recipes', 'binary.sha256', '--rate-limit', '50'],
      { from: 'user' },
    );

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ rateLimitPerMinute: 50 }));
  });

  it('prints a table row with a configured hammingThreshold/rateLimitPerMinute formatted, not blank', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      ...PROJECT,
      hammingThreshold: 90,
      rateLimitPerMinute: 50,
    });

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(
      ['create', '--slug', 'demo', '--name', 'Demo', '--recipes', 'binary.sha256', '--hamming-threshold', '90'],
      { from: 'user' },
    );

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('90.00');
    expect(output).toContain('50');
  });

  it('prints JSON when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['create', '--slug', 'demo', '--name', 'Demo', '--recipes', 'binary.sha256', '--json'], {
      from: 'user',
    });

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(JSON.parse(output)).toMatchObject({ id: 'p1', slug: 'demo' });
  });

  it('prints an error and exits on failure (e.g. duplicate slug)', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.commandGateway, 'dispatch').mockRejectedValue(new Error('duplicate slug'));

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['create', '--slug', 'demo', '--name', 'Demo', '--recipes', 'binary.sha256'], {
      from: 'user',
    });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('project update', () => {
  it('looks up the project by slug and dispatches UpdateProjectSettings', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    const getBySlugSpy = vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['update', '--slug', 'demo', '--recipes', 'binary.sha256,image.phash16'], {
      from: 'user',
    });

    expect(getBySlugSpy).toHaveBeenCalledWith('demo');
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', recipes: ['binary.sha256', 'image.phash16'] }),
    );
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(UpdateProjectSettings));
  });

  it('treats --hamming-threshold none as clearing it back to null', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['update', '--slug', 'demo', '--hamming-threshold', 'none'], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ hammingThreshold: null }));
  });

  it('parses a real --hamming-threshold value', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['update', '--slug', 'demo', '--hamming-threshold', '80'], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ hammingThreshold: 80 }));
  });

  it('treats --rate-limit none as clearing it back to the config default', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['update', '--slug', 'demo', '--rate-limit', 'none'], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ rateLimitPerMinute: null }));
  });

  it('parses a real --rate-limit value', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['update', '--slug', 'demo', '--rate-limit', '50'], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ rateLimitPerMinute: 50 }));
  });

  it('leaves recipes/hammingThreshold undefined when not passed', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['update', '--slug', 'demo'], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ recipes: undefined, hammingThreshold: undefined }),
    );
  });

  it('prints JSON when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(PROJECT);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['update', '--slug', 'demo', '--json'], { from: 'user' });

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(JSON.parse(output)).toMatchObject({ id: 'p1', slug: 'demo' });
  });

  it('prints an error and exits when the project is not found', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockRejectedValue(new Error('not found'));

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['update', '--slug', 'nope'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('prints an error and exits when the dispatch itself fails (e.g. invalid recipes)', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    vi.spyOn(cradle.commandGateway, 'dispatch').mockRejectedValue(new Error('recipes must contain at least one'));

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['update', '--slug', 'demo', '--recipes', ''], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('project list', () => {
  it('prints a table of projects', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.list as ReturnType<typeof vi.fn>).mockResolvedValue([PROJECT]);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['list'], { from: 'user' });

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('demo');
  });

  it('prints JSON when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['list', '--json'], { from: 'user' });

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(JSON.parse(output)).toEqual([]);
  });

  it('prints an error and exits on failure', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['list'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('project delete', () => {
  it('without --yes, prints what would be deleted and exits 1 without dispatching', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    (cradle.assets.countByProject as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (cradle.apiClients.listByProject as ReturnType<typeof vi.fn>).mockResolvedValue([{}, {}]);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch');

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['delete', '--slug', 'demo'], { from: 'user' });

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('with --yes, dispatches DeleteProject and prints success', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockResolvedValue(PROJECT);
    (cradle.assets.countByProject as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (cradle.apiClients.listByProject as ReturnType<typeof vi.fn>).mockResolvedValue([{}]);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(undefined);

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['delete', '--slug', 'demo', '--yes'], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(DeleteProject));
    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('Deleted');
  });

  it('prints an error and exits when the project is not found', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.projects, 'getBySlug').mockRejectedValue(new Error('not found'));

    const command = buildProjectCommand(() => cradle);
    await command.parseAsync(['delete', '--slug', 'nope', '--yes'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
