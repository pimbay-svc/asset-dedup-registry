import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { buildApiClientCommand } from '../../../../src/presentation/cli/command/apiClient.command.js';
import { buildFakeCradle } from '../../../helpers/fakeCradle.js';
import { CreateApiClient, RevokeApiClient } from '../../../../src/application/command/apiClient.command.js';
import { ApiScope } from '../../../../src/domain/model/apiClient.model.js';
import type { Project } from '../../../../src/domain/model/model.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockExit(): MockInstance<(code?: number | string | null) => never> {
  return vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
}

const project: Project = {
  id: 'project-1',
  slug: 'demo',
  name: 'Demo',
  recipes: ['binary.sha256'],
  hammingThreshold: null,
  rateLimitPerMinute: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('api-client create', () => {
  it('creates a client and prints the raw key once', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(project);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      apiClient: { id: 'client-1', name: 'ci', projectId: 'project-1' },
      rawKey: 'the-raw-key',
    });

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(['create', '--project', 'demo', '--name', 'ci', '--scopes', ApiScope.ASSETS_READ], {
      from: 'user',
    });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CreateApiClient));
    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('the-raw-key');
  });

  it('trims whitespace and drops empty entries from --scopes (e.g. a trailing comma)', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(project);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      apiClient: { id: 'client-1', name: 'ci', projectId: 'project-1' },
      rawKey: 'the-raw-key',
    });

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(
      [
        'create',
        '--project',
        'demo',
        '--name',
        'ci',
        '--scopes',
        ` ${ApiScope.ASSETS_READ} , ${ApiScope.ASSETS_WRITE},`,
      ],
      { from: 'user' },
    );

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: [ApiScope.ASSETS_READ, ApiScope.ASSETS_WRITE] }),
    );
  });

  it('prints JSON when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(project);
    (cradle.commandGateway.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      apiClient: { id: 'client-1', name: 'ci' },
      rawKey: 'the-raw-key',
    });

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(
      ['create', '--project', 'demo', '--name', 'ci', '--scopes', ApiScope.ASSETS_READ, '--json'],
      { from: 'user' },
    );

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(JSON.parse(output)).toMatchObject({ id: 'client-1', api_key: 'the-raw-key' });
  });

  it('rejects invalid scopes and exits without dispatching', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(project);

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(['create', '--project', 'demo', '--name', 'ci', '--scopes', 'not-a-scope'], {
      from: 'user',
    });

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('prints an error and exits when the project lookup fails', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Project 'demo' not found"));

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(['create', '--project', 'demo', '--name', 'ci', '--scopes', ApiScope.ASSETS_READ], {
      from: 'user',
    });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('api-client list', () => {
  it('prints a table of clients for the project', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(project);
    (cradle.apiClients.listByProject as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', name: 'ci', scopes: [ApiScope.ASSETS_READ], revokedAt: null },
      { id: 'c2', name: 'old', scopes: [ApiScope.ASSETS_WRITE], revokedAt: new Date('2024-01-01T00:00:00Z') },
    ]);

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(['list', '--project', 'demo'], { from: 'user' });

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('ci');
    expect(output).toContain('2024-01-01');
  });

  it('prints JSON when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(project);
    (cradle.apiClients.listByProject as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(['list', '--project', 'demo', '--json'], { from: 'user' });

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(JSON.parse(output)).toEqual([]);
  });

  it('prints an error and exits on failure', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(['list', '--project', 'demo'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('api-client revoke', () => {
  it('dispatches RevokeApiClient and prints a success message', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(undefined);

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(['revoke', '--id', 'client-1'], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(RevokeApiClient));
    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('client-1');
  });

  it('prints an error and exits on failure', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.commandGateway.dispatch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    const command = buildApiClientCommand(() => cradle);
    await command.parseAsync(['revoke', '--id', 'nope'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
