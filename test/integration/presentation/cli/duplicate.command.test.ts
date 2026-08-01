import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { buildDuplicatesCommand } from '../../../../src/presentation/cli/command/duplicate.command.js';
import { buildFakeCradle } from '../../../helpers/fakeCradle.js';
import { buildPage, type PageSnapshot } from '../../../helpers/page.js';
import { Comparison } from '../../../../src/domain/model/algorithm.model.js';
import type { Project, Algorithm } from '../../../../src/domain/model/model.js';
import { Identity } from '../../../../src/domain/model/asset.model.js';

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
  recipes: ['binary.sha256', 'image.phash16'],
  hammingThreshold: null,
  rateLimitPerMinute: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const HAMMING_ALGORITHM: Algorithm = { id: 2, recipe: 'image.phash16', comparison: Comparison.HAMMING };
const EXACT_ALGORITHM: Algorithm = { id: 1, recipe: 'binary.sha256', comparison: Comparison.EXACT };

function setupScope(cradle: ReturnType<typeof buildFakeCradle>, algorithm: Algorithm, thresholdIgnored = false): void {
  (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
  (cradle.scopeResolver.resolveDuplicateScope as ReturnType<typeof vi.fn>).mockResolvedValue({
    project: PROJECT,
    algorithm,
    minSimilarity: 90,
    thresholdIgnored,
  });
  (cradle.assets.getByIdentity as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'asset-1',
    projectId: PROJECT.id,
    identityId: 'a1',
    identityPath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('duplicates matches', () => {
  const EMPTY_PAGE: PageSnapshot<never> = {
    data: [],
    totalCount: 0,
    currentCount: 0,
    currentPage: 1,
    pageSize: 20,
    pageCount: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };

  it('resolves scope and prints similarity+distance for a hamming recipe', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    const paginateMatchesSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches').mockResolvedValue(
      buildPage({
        ...EMPTY_PAGE,
        data: [{ identity: new Identity('a2', null), distance: 3, similarity: 95.3 }],
        totalCount: 1,
        currentCount: 1,
      }),
    );

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['matches', '--project', 'demo', '--id', 'a1', '--recipe', 'image.phash16'], {
      from: 'user',
    });

    expect(paginateMatchesSpy).toHaveBeenCalledWith(
      { projectId: 'p1', algorithmId: 2, identity: new Identity('a1', null), minSimilarity: 90 },
      1,
      20,
    );
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('a2');
    expect(output).toContain('distance');
    expect(output).toContain('Page 1/1');
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('accepts a path-only identity when --id is omitted', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    const paginateMatchesSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches').mockResolvedValue(
      buildPage({
        ...EMPTY_PAGE,
        data: [{ identity: new Identity('a2', null), distance: 3, similarity: 95.3 }],
        totalCount: 1,
        currentCount: 1,
      }),
    );

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(
      ['matches', '--project', 'demo', '--path', '/library/photo.jpg', '--recipe', 'image.phash16'],
      { from: 'user' },
    );

    expect(paginateMatchesSpy).toHaveBeenCalledWith(
      { projectId: 'p1', algorithmId: 2, identity: new Identity(null, '/library/photo.jpg'), minSimilarity: 90 },
      1,
      20,
    );
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('a2');
  });

  it('omits the distance column for an exact-comparison recipe', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, EXACT_ALGORITHM);
    vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches').mockResolvedValue(
      buildPage({
        ...EMPTY_PAGE,
        data: [{ identity: new Identity('a2', null), distance: 0, similarity: 100 }],
        totalCount: 1,
        currentCount: 1,
      }),
    );

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['matches', '--project', 'demo', '--id', 'a1', '--recipe', 'binary.sha256'], {
      from: 'user',
    });

    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).not.toContain('distance');
  });

  it('warns on stderr when --threshold is given for an exact-comparison recipe', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, EXACT_ALGORITHM, true);
    vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches').mockResolvedValue(buildPage(EMPTY_PAGE));

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(
      ['matches', '--project', 'demo', '--id', 'a1', '--recipe', 'binary.sha256', '--threshold', '50'],
      { from: 'user' },
    );

    const stderrOutput = stderrWrite.mock.calls.map((c) => c[0]).join('');
    expect(stderrOutput).toContain('ignored for exact-comparison');
  });

  it('prints JSON when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches').mockResolvedValue(buildPage(EMPTY_PAGE));

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['matches', '--project', 'demo', '--id', 'a1', '--recipe', 'image.phash16', '--json'], {
      from: 'user',
    });

    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(JSON.parse(output)).toEqual(EMPTY_PAGE);
  });

  it('honors explicit --page/--page-size options', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    const paginateMatchesSpy = vi
      .spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches')
      .mockResolvedValue(buildPage(EMPTY_PAGE));

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(
      ['matches', '--project', 'demo', '--id', 'a1', '--recipe', 'image.phash16', '--page', '2', '--page-size', '5'],
      { from: 'user' },
    );

    expect(paginateMatchesSpy).toHaveBeenCalledWith(expect.anything(), 2, 5);
  });

  it('prints an error and exits on failure', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['matches', '--project', 'nope', '--id', 'a1', '--recipe', 'x'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('duplicates clusters', () => {
  it('prints each cluster with its assets table', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    vi.spyOn(cradle.clustersSearch, 'paginate').mockResolvedValue({
      generation: 7,
      page: buildPage({
        data: [
          {
            clusterId: 'c1',
            maxSimilarity: 99,
            assets: [{ identity: new Identity('a1', null), avgSimilarityToCluster: 98 }],
          },
        ],
        totalCount: 1,
        currentCount: 1,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    });

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['clusters', '--project', 'demo', '--recipe', 'image.phash16'], { from: 'user' });

    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('c1');
    expect(output).toContain('a1');
    expect(output).toContain('Page 1/1');
    expect(output).toContain('generation: 7');
  });

  it('passes --id and --path through as an id/path filter', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    const paginateSpy = vi.spyOn(cradle.clustersSearch, 'paginate').mockResolvedValue({
      generation: 1,
      page: buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    });

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(
      ['clusters', '--project', 'demo', '--recipe', 'image.phash16', '--id', 'a1', '--path', '*invoice*'],
      { from: 'user' },
    );

    expect(paginateSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', path: '*invoice*' }), 1, 20);
  });

  it('prints a message when there are no clusters', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    vi.spyOn(cradle.clustersSearch, 'paginate').mockResolvedValue({
      generation: 1,
      page: buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    });

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['clusters', '--project', 'demo', '--recipe', 'image.phash16'], { from: 'user' });

    const output = stderrWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('no duplicate clusters');
  });

  it('prints JSON (including generation) when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    vi.spyOn(cradle.clustersSearch, 'paginate').mockResolvedValue({
      generation: 9,
      page: buildPage({
        data: [
          {
            clusterId: 'c1',
            maxSimilarity: 99,
            assets: [{ identity: new Identity('a1', null), avgSimilarityToCluster: 98 }],
          },
        ],
        totalCount: 1,
        currentCount: 1,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    });

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['clusters', '--project', 'demo', '--recipe', 'image.phash16', '--json'], {
      from: 'user',
    });

    const output = write.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output) as { generation: number; data: unknown[] };
    expect(parsed.generation).toBe(9);
    expect(parsed.data).toHaveLength(1);
  });

  it('passes --generation through to pin a specific snapshot', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    const paginateSpy = vi.spyOn(cradle.clustersSearch, 'paginate').mockResolvedValue({
      generation: 5,
      page: buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    });

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['clusters', '--project', 'demo', '--recipe', 'image.phash16', '--generation', '5'], {
      from: 'user',
    });

    expect(paginateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 5 }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('prints an error and exits on failure', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['clusters', '--project', 'nope', '--recipe', 'image.phash16'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('duplicates ranking', () => {
  it('prints the nested per-asset match listing', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking').mockResolvedValue(
      buildPage({
        data: [
          {
            identity: new Identity('a1', null),
            duplicateCount: 1,
            matches: [{ identity: new Identity('a2', null), distance: 1, similarity: 95 }],
          },
        ],
        totalCount: 1,
        currentCount: 1,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['ranking', '--project', 'demo', '--recipe', 'image.phash16'], { from: 'user' });

    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('id=a1');
    expect(output).toContain('* id=a2');
    expect(output).toContain('Page 1/1');
  });

  it('passes --id and --path through as an id/path filter', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    const paginateRankingSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking').mockResolvedValue(
      buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(
      ['ranking', '--project', 'demo', '--recipe', 'image.phash16', '--id', 'a1', '--path', '*invoice*'],
      { from: 'user' },
    );

    expect(paginateRankingSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', path: '*invoice*' }), 1, 20);
  });

  it('rejects a page-size above the maximum', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    const paginateRankingSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking');

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['ranking', '--project', 'demo', '--recipe', 'image.phash16', '--page-size', '500'], {
      from: 'user',
    });

    expect(paginateRankingSpy).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('prints JSON when --json is passed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking').mockResolvedValue(
      buildPage({
        data: [
          {
            identity: new Identity('a1', null),
            duplicateCount: 1,
            matches: [{ identity: new Identity('a2', null), distance: 1, similarity: 95 }],
          },
        ],
        totalCount: 1,
        currentCount: 1,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['ranking', '--project', 'demo', '--recipe', 'image.phash16', '--json'], {
      from: 'user',
    });

    const output = write.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output) as { data: unknown[] };
    expect(parsed.data).toHaveLength(1);
  });

  it('passes --match-limit through to cap matches shown per asset', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    setupScope(cradle, HAMMING_ALGORITHM);
    const paginateRankingSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking').mockResolvedValue(
      buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['ranking', '--project', 'demo', '--recipe', 'image.phash16', '--match-limit', '3'], {
      from: 'user',
    });

    expect(paginateRankingSpy).toHaveBeenCalledWith(
      expect.objectContaining({ matchLimit: 3 }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('prints an error and exits on failure', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['ranking', '--project', 'nope', '--recipe', 'image.phash16'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('duplicates recompute', () => {
  it('recomputes every hamming-comparison recipe configured for the project', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    vi.spyOn(cradle.algorithms, 'findByRecipe').mockImplementation((recipe: string) =>
      Promise.resolve(recipe === 'binary.sha256' ? EXACT_ALGORITHM : HAMMING_ALGORITHM),
    );
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockImplementation((command) => {
      (command as { onBatch?: (done: number) => void }).onBatch?.(3);

      return Promise.resolve(5);
    });

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['recompute', '--project', 'demo'], { from: 'user' });

    // only the hamming recipe (image.phash16) is recomputed — binary.sha256 (exact) is skipped
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', algorithmId: HAMMING_ALGORITHM.id, comparison: Comparison.HAMMING }),
    );
    const output = write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('3 assets processed...');
    expect(output).toContain("done: 5 asset(s) processed for 'image.phash16'");
  });

  it('exits 1 when no hamming-comparison recipes have been hashed yet', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    (cradle.algorithms.findByRecipe as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch');

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['recompute', '--project', 'demo'], { from: 'user' });

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('caps --batch-size at the maximum', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    (cradle.algorithms.findByRecipe as ReturnType<typeof vi.fn>).mockResolvedValue(HAMMING_ALGORITHM);
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(0);

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['recompute', '--project', 'demo', '--batch-size', '999999'], { from: 'user' });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 1000 }));
  });

  it('prints an error and exits when the project is not found', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['recompute', '--project', 'nope'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('prints an error and exits when a recipe fails mid-recompute', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = mockExit();
    const cradle = buildFakeCradle();
    (cradle.projects.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    (cradle.algorithms.findByRecipe as ReturnType<typeof vi.fn>).mockImplementation((recipe: string) =>
      Promise.resolve(recipe === 'binary.sha256' ? EXACT_ALGORITHM : HAMMING_ALGORITHM),
    );
    vi.spyOn(cradle.commandGateway, 'dispatch').mockRejectedValue(new Error('core unreachable'));

    const command = buildDuplicatesCommand(() => cradle);
    await command.parseAsync(['recompute', '--project', 'demo'], { from: 'user' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
