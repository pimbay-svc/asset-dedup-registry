import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAssetCommand } from '../../../../src/presentation/cli/command/asset.command.js';
import { buildFakeCradle } from '../../../helpers/fakeCradle.js';
import { AddAsset, DeleteAsset } from '../../../../src/application/command/asset.command.js';
import { AssetAddStatus, Identity } from '../../../../src/domain/model/asset.model.js';
import { MimeHintType } from '../../../../src/domain/model/asset.model.js';
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

let tmpDir: string | undefined;

function writeTempFile(name: string, content = 'hello'): string {
  tmpDir ??= mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
  const filePath = path.join(tmpDir, name);
  writeFileSync(filePath, content);

  return filePath;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('asset add', () => {
  it('reads the file, derives a mime hint from its extension, and dispatches AddAsset', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      identity: new Identity('asset-1', null),
      results: [{ recipe: 'binary.sha256', hashes: ['abc123'], status: AssetAddStatus.CREATED }],
    });
    const filePath = writeTempFile('photo.jpg');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['add', '--project', 'demo', '--id', 'asset-1', '--file', filePath], {
      from: 'user',
    });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(AddAsset));
    const dispatched = dispatchSpy.mock.calls[0]?.[0] as AddAsset;
    expect(dispatched.mimeHint).toEqual({ type: MimeHintType.EXTENSION, value: 'jpg' });
    expect(dispatched.identityId).toBe('asset-1');
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('created');
  });

  it('dispatches AddAsset with a path-only identity when --id is omitted', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      identity: new Identity(null, '/library/photo.jpg'),
      results: [{ recipe: 'binary.sha256', hashes: ['abc123'], status: AssetAddStatus.CREATED }],
    });
    const filePath = writeTempFile('photo.jpg');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['add', '--project', 'demo', '--path', '/library/photo.jpg', '--file', filePath], {
      from: 'user',
    });

    const dispatched = dispatchSpy.mock.calls[0]?.[0] as AddAsset;
    expect(dispatched.identityId).toBeNull();
    expect(dispatched.identityPath).toBe('/library/photo.jpg');
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('created');
  });

  it('prints JSON when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    (cradle.commandGateway.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      identity: new Identity('asset-1', null),
      results: [],
    });
    const filePath = writeTempFile('photo.jpg');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['add', '--project', 'demo', '--id', 'asset-1', '--file', filePath, '--json'], {
      from: 'user',
    });

    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(JSON.parse(output)).toEqual({
      identity: new Identity('asset-1', null),
      results: [],
    });
  });

  it('rejects a file with no extension before dispatching anything', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch');
    const filePath = writeTempFile('noextension');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['add', '--project', 'demo', '--id', 'asset-1', '--file', filePath], {
      from: 'user',
    });

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('prints an error and exits when the project is not found', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
    const filePath = writeTempFile('photo.jpg');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['add', '--project', 'nope', '--id', 'asset-1', '--file', filePath], {
      from: 'user',
    });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('asset scan', () => {
  it('hashes every file under root and reports a per-file status summary', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      identity: new Identity(null, 'x'),
      results: [{ recipe: 'binary.sha256', hashes: ['abc'], status: AssetAddStatus.CREATED }],
    });
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    writeFileSync(path.join(tmpDir, 'a.jpg'), 'a');
    writeFileSync(path.join(tmpDir, 'b.jpg'), 'b');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['scan', '--project', 'demo', '--root', tmpDir], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('created');
    expect(output).toContain('Done: 2 files');
  });

  it('exits 1 and reports failures without stopping the whole scan', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    (cradle.commandGateway.dispatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        identity: new Identity(null, 'a'),
        results: [{ recipe: 'binary.sha256', hashes: ['x'], status: AssetAddStatus.CREATED }],
      })
      .mockRejectedValueOnce(new Error('core down'));
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    writeFileSync(path.join(tmpDir, 'a.jpg'), 'a');
    writeFileSync(path.join(tmpDir, 'b.jpg'), 'b');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['scan', '--project', 'demo', '--root', tmpDir], { from: 'user' });

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when no files match the include patterns', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    mkdirSync(path.join(tmpDir, 'empty'));
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['scan', '--project', 'demo', '--root', path.join(tmpDir, 'empty')], { from: 'user' });

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('applies --path-prefix instead of the absolute path as the asset path', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      identity: new Identity(null, 'x'),
      results: [{ recipe: 'binary.sha256', hashes: ['abc'], status: AssetAddStatus.CREATED }],
    });
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    writeFileSync(path.join(tmpDir, 'a.jpg'), 'a');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['scan', '--project', 'demo', '--root', tmpDir, '--path-prefix', 's3://bucket/'], {
      from: 'user',
    });

    const dispatched = dispatchSpy.mock.calls[0]?.[0] as AddAsset;
    expect(dispatched.identityPath).toBe('s3://bucket/a.jpg');
  });

  it('accepts --include more than once, scanning the union of the given patterns', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      identity: new Identity(null, 'x'),
      results: [{ recipe: 'binary.sha256', hashes: ['abc'], status: AssetAddStatus.CREATED }],
    });
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    writeFileSync(path.join(tmpDir, 'a.jpg'), 'a');
    writeFileSync(path.join(tmpDir, 'b.png'), 'b');
    writeFileSync(path.join(tmpDir, 'c.gif'), 'c');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(
      ['scan', '--project', 'demo', '--root', tmpDir, '--include', '*.jpg', '--include', '*.png'],
      { from: 'user' },
    );

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
  });

  it('reports "updated" for a file whose hash changed (not newly created)', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      identity: new Identity(null, 'x'),
      results: [{ recipe: 'binary.sha256', hashes: ['abc'], status: AssetAddStatus.UPDATED }],
    });
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    writeFileSync(path.join(tmpDir, 'a.jpg'), 'a');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['scan', '--project', 'demo', '--root', tmpDir], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('updated');
    expect(output).toContain('Done: 1 files — 0 created, 1 updated');
  });

  it('reports "unchanged" for a file whose hash did not change', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      identity: new Identity(null, 'x'),
      results: [{ recipe: 'binary.sha256', hashes: ['abc'], status: AssetAddStatus.UNCHANGED }],
    });
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    writeFileSync(path.join(tmpDir, 'a.jpg'), 'a');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['scan', '--project', 'demo', '--root', tmpDir], { from: 'user' });

    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('unchanged');
    expect(output).toContain('Done: 1 files — 0 created, 0 updated, 1 unchanged');
  });

  it('formats a non-Error rejection (e.g. a thrown string) as a failure message', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    vi.spyOn(cradle.commandGateway, 'dispatch').mockRejectedValue('boom');
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    writeFileSync(path.join(tmpDir, 'a.jpg'), 'a');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['scan', '--project', 'demo', '--root', tmpDir, '--json'], { from: 'user' });

    const output = write.mock.calls[write.mock.calls.length - 1]?.[0] as string;
    const parsed = JSON.parse(output) as { failures: { path: string; error: string }[] };
    expect(parsed.failures[0]?.error).toBe('boom');
  });

  it('prints a JSON summary (with failures) when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    (cradle.commandGateway.dispatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        identity: new Identity(null, 'a'),
        results: [{ recipe: 'binary.sha256', hashes: ['x'], status: AssetAddStatus.CREATED }],
      })
      .mockRejectedValueOnce(new Error('core down'));
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    writeFileSync(path.join(tmpDir, 'a.jpg'), 'a');
    writeFileSync(path.join(tmpDir, 'b.jpg'), 'b');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['scan', '--project', 'demo', '--root', tmpDir, '--json'], { from: 'user' });

    const output = write.mock.calls[write.mock.calls.length - 1]?.[0] as string;
    const parsed = JSON.parse(output) as { total: number; created: number; failed: number; failures: unknown[] };
    expect(parsed.total).toBe(2);
    expect(parsed.created).toBe(1);
    expect(parsed.failed).toBe(1);
    expect(parsed.failures).toHaveLength(1);
  });

  it('prints an error and exits when the project is not found', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
    tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-cli-test-'));
    writeFileSync(path.join(tmpDir, 'a.jpg'), 'a');

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['scan', '--project', 'nope', '--root', tmpDir], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('asset delete', () => {
  it('dispatches DeleteAsset and prints success', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(undefined);

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['delete', '--project', 'demo', '--id', 'asset-1'], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(DeleteAsset));
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('asset-1');
  });

  it('dispatches DeleteAsset with a path-only identity when --id is omitted', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(undefined);

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['delete', '--project', 'demo', '--path', '/library/photo.jpg'], { from: 'user' });

    const dispatched = dispatchSpy.mock.calls[0]?.[0] as DeleteAsset;
    expect(dispatched.identity).toEqual(new Identity(null, '/library/photo.jpg'));
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('/library/photo.jpg');
  });

  it('prints an error and exits on failure', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['delete', '--project', 'demo', '--id', 'asset-1'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('asset recipes', () => {
  it('prints a table of recipes for the asset', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    (cradle.assets.listRecipes as ReturnType<typeof vi.fn>).mockResolvedValue(['binary.sha256', 'image.phash16']);

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['recipes', '--project', 'demo', '--id', 'asset-1'], { from: 'user' });

    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('binary.sha256');
    expect(output).toContain('image.phash16');
  });

  it('prints JSON when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    (cradle.assets.listRecipes as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['recipes', '--project', 'demo', '--id', 'asset-1', '--json'], { from: 'user' });

    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(JSON.parse(output)).toEqual({ identity: { id: 'asset-1', path: null }, recipes: [] });
  });

  it('resolves recipes by a path-only identity when --id is omitted', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    const listRecipesSpy = vi.spyOn(cradle.assets, 'listRecipes').mockResolvedValue(['binary.sha256']);

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['recipes', '--project', 'demo', '--path', '/library/photo.jpg'], { from: 'user' });

    expect(listRecipesSpy).toHaveBeenCalledWith(PROJECT.id, new Identity(null, '/library/photo.jpg'));
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('binary.sha256');
  });

  it('prints an error and exits when the project is not found', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    const command = buildAssetCommand(() => cradle);
    await command.parseAsync(['recipes', '--project', 'nope', '--id', 'asset-1'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
