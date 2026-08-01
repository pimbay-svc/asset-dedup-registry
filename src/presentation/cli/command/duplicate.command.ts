/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { Command } from 'commander';
import type { Page } from '@pimbay/search-query';
import { printJson, printTable, printError, formatError, formatIdentity } from '../output.js';
import type { Cradle } from '../../../infrastructure/container.js';
import { Comparison } from '../../../domain/model/algorithm.model.js';
import { Identity } from '../../../domain/model/asset.model.js';
import type { Algorithm, Project } from '../../../domain/model/model.js';
import type { Projects } from '../../../domain/repo/project.repo.js';
import type { ScopeResolver } from '../../scopeResolver.js';
import { RecomputeProject } from '../../../application/command/asset.command.js';
import { mapPageToJson } from '../mapping.js';
import { parsePage, parsePositiveInt, parseOptionalLimit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../parse.js';
import { DuplicateMessages as msg } from '../messages.js';

interface DuplicateCommandOpts {
  project: string;
  recipe: string;
  threshold?: string;
}

function formatPageFooter<T>(page: Page<T>, noun: string): string {
  return msg.pageFooter(page.getCurrentPage(), page.getPageCount(), page.getTotalCount(), noun);
}

async function resolveScope(
  projects: Projects,
  scopeResolver: ScopeResolver,
  opts: DuplicateCommandOpts,
): Promise<{ project: Project; algorithm: Algorithm; minSimilarity: number }> {
  const project0 = await projects.getBySlug(opts.project);
  const { project, algorithm, minSimilarity, thresholdIgnored } = await scopeResolver.resolveDuplicateScope(
    project0.id,
    opts.recipe,
    opts.threshold,
  );

  if (thresholdIgnored) {
    process.stderr.write(msg.THRESHOLD_IGNORED_WARNING);
  }

  return { project, algorithm, minSimilarity };
}

interface AssetDuplicateRow {
  identity: Identity;
  duplicateCount: number;
  matches: { identity: Identity; similarity: number }[];
}

/** `duplicates ranking` layout: header row, then per asset a summary row + its matches as bullet lines. */
function printRankingList(rows: readonly AssetDuplicateRow[]): void {
  if (rows.length === 0) {
    process.stdout.write(msg.NO_RESULTS);

    return;
  }

  const columns = ['asset_id', 'similarity', 'duplicate_count'];
  const assetIdWidth = Math.max(
    /* v8 ignore next -- defensive: `columns` is a fixed 3-element literal, columns[0] is always defined */
    columns[0]?.length ?? 0,
    ...rows.flatMap((r) => [
      formatIdentity(r.identity).length,
      ...r.matches.map((m) => `* ${formatIdentity(m.identity)}`.length),
    ]),
  );
  /* v8 ignore next -- defensive: `columns` is a fixed 3-element literal, columns[1] is always defined */
  const similarityWidth = columns[1]?.length ?? 0;
  /* v8 ignore next -- defensive: `columns` is a fixed 3-element literal, columns[2] is always defined */
  const widths = [assetIdWidth, similarityWidth, columns[2]?.length ?? 0];

  process.stdout.write(
    /* v8 ignore next -- defensive: `widths` has one entry per column, widths[i] is always defined here */
    columns.map((col, i) => col.padEnd(widths[i] ?? col.length)).join('  ') + '\n',
  );
  process.stdout.write(widths.map((w) => '-'.repeat(w)).join('  ') + '\n');

  for (const row of rows) {
    process.stdout.write(
      [formatIdentity(row.identity).padEnd(assetIdWidth), ''.padEnd(similarityWidth), String(row.duplicateCount)].join(
        '  ',
      ) + '\n',
    );

    for (const match of row.matches) {
      process.stdout.write(
        [
          `* ${formatIdentity(match.identity)}`.padEnd(assetIdWidth),
          String(match.similarity).padEnd(similarityWidth),
        ].join('  ') + '\n',
      );
    }

    process.stdout.write('\n');
  }
}

const DEFAULT_RECOMPUTE_BATCH_SIZE = 200;
const MAX_RECOMPUTE_BATCH_SIZE = 1000;

export function buildDuplicatesCommand(getCradle: () => Cradle): Command {
  const command = new Command('duplicates').description('Query precomputed duplicate matches');

  command
    .command('matches')
    .description('Paginated list of the closest matches for a single asset — at least one of --id/--path is required')
    .requiredOption('--project <slug>', 'Project slug')
    .option('--id <id>', 'Asset identity id')
    .option('--path <path>', 'Asset identity path')
    .requiredOption('--recipe <recipe>', "Recipe to compare on (must be one of the project's configured recipes)")
    .option('--threshold <pct>', 'Minimum similarity % (0-100) — defaults to the project/config default')
    .option('--page <n>', 'Page number (default: 1)')
    .option('--page-size <n>', `Page size (default: ${String(DEFAULT_PAGE_SIZE)}, max ${String(MAX_PAGE_SIZE)})`)
    .option('--json', 'Output as JSON')
    .action(
      async (
        opts: DuplicateCommandOpts & { id?: string; path?: string; page?: string; pageSize?: string; json?: boolean },
      ) => {
        const { assetHashDuplicatesSearch, assets, projects, scopeResolver } = getCradle();

        try {
          const { project, algorithm, minSimilarity } = await resolveScope(projects, scopeResolver, opts);
          const page = parsePage(opts, 'page-size');
          const identity = new Identity(opts.id ?? null, opts.path ?? null);
          await assets.getByIdentity(project.id, identity);

          const result = await assetHashDuplicatesSearch.paginateMatches(
            { projectId: project.id, algorithmId: algorithm.id, identity, minSimilarity },
            page.page,
            page.size,
          );

          if (opts.json === true) {
            printJson(mapPageToJson(result));
          } else {
            if (algorithm.comparison === Comparison.HAMMING) {
              // distance is only meaningful for hamming; shown after similarity
              printTable(
                result.getData().map((m) => ({
                  asset_id: formatIdentity(m.identity),
                  similarity: m.similarity,
                  distance: m.distance,
                })),
                ['asset_id', 'similarity', 'distance'],
              );
            } else {
              printTable(
                result.getData().map((m) => ({ asset_id: formatIdentity(m.identity), similarity: m.similarity })),
                ['asset_id', 'similarity'],
              );
            }
            process.stdout.write(formatPageFooter(result, 'matches'));
          }
        } catch (err) {
          printError(formatError(err));
          process.exit(1);
        }
      },
    );

  command
    .command('clusters')
    .description(
      'Paginated list of clusters of mutually similar assets — computed fresh for --threshold and cached ' +
        'until the next write invalidates it (see DECISIONS.md).',
    )
    .requiredOption('--project <slug>', 'Project slug')
    .requiredOption('--recipe <recipe>', 'Recipe to compare on')
    .option('--threshold <pct>', 'Minimum similarity % (0-100)')
    .option(
      '--generation <n>',
      'Pin to a specific snapshot (from a previous --json response) to keep paging the same ' +
        'results even if data changes in between; omit for the current snapshot',
    )
    .option('--page <n>', 'Page number (default: 1)')
    .option('--page-size <n>', `Page size (default: ${String(DEFAULT_PAGE_SIZE)}, max ${String(MAX_PAGE_SIZE)})`)
    .option('--id <id>', 'Only clusters containing a member with this exact identity id')
    .option('--path <term>', 'Only clusters containing a member whose identity path matches this term (e.g. *invoice*)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        opts: DuplicateCommandOpts & {
          generation?: string;
          page?: string;
          pageSize?: string;
          id?: string;
          path?: string;
          json?: boolean;
        },
      ) => {
        const { clustersSearch, projects, scopeResolver } = getCradle();

        try {
          const { project, algorithm, minSimilarity } = await resolveScope(projects, scopeResolver, opts);
          const page = parsePage(opts, 'page-size');
          const generation = parseOptionalLimit(opts.generation, 'generation');

          const result = await clustersSearch.paginate(
            {
              projectId: project.id,
              algorithmId: algorithm.id,
              minSimilarity,
              ...(generation !== undefined && { generation }),
              ...(opts.id !== undefined && { id: opts.id }),
              ...(opts.path !== undefined && { path: opts.path }),
            },
            page.page,
            page.size,
          );

          if (opts.json === true) {
            printJson({ ...mapPageToJson(result.page), generation: result.generation });
          } else if (result.page.getData().length === 0) {
            printError(msg.NO_CLUSTERS);
          } else {
            for (const cluster of result.page.getData()) {
              process.stdout.write(msg.clusterHeader(cluster.clusterId, cluster.maxSimilarity));
              printTable(
                cluster.assets.map((a) => ({
                  asset_id: formatIdentity(a.identity),
                  avg_similarity: a.avgSimilarityToCluster,
                })),
                ['asset_id', 'avg_similarity'],
              );
            }
            process.stdout.write(formatPageFooter(result.page, 'clusters'));
            process.stdout.write(msg.generationFooter(result.generation));
          }
        } catch (err) {
          printError(formatError(err));
          process.exit(1);
        }
      },
    );

  command
    .command('ranking')
    .description('Paginated list of assets ranked by duplicate count')
    .requiredOption('--project <slug>', 'Project slug')
    .requiredOption('--recipe <recipe>', 'Recipe to compare on')
    .option('--threshold <pct>', 'Minimum similarity % (0-100)')
    .option('--page <n>', 'Page number (default: 1)')
    .option('--page-size <n>', `Page size (default: ${String(DEFAULT_PAGE_SIZE)}, max ${String(MAX_PAGE_SIZE)})`)
    .option('--match-limit <n>', 'Max matches shown per asset')
    .option('--id <id>', 'Only assets with this exact identity id')
    .option('--path <term>', 'Only assets whose identity path matches this term (e.g. *invoice*)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        opts: DuplicateCommandOpts & {
          page?: string;
          pageSize?: string;
          matchLimit?: string;
          id?: string;
          path?: string;
          json?: boolean;
        },
      ) => {
        const { assetHashDuplicatesSearch, projects, scopeResolver } = getCradle();

        try {
          const { project, algorithm, minSimilarity } = await resolveScope(projects, scopeResolver, opts);
          const matchLimit = parseOptionalLimit(opts.matchLimit);
          const page = parsePage(opts, 'page-size');

          const result = await assetHashDuplicatesSearch.paginateRanking(
            {
              projectId: project.id,
              algorithmId: algorithm.id,
              minSimilarity,
              ...(matchLimit !== undefined && { matchLimit }),
              ...(opts.id !== undefined && { id: opts.id }),
              ...(opts.path !== undefined && { path: opts.path }),
            },
            page.page,
            page.size,
          );

          if (opts.json === true) {
            printJson(mapPageToJson(result));
          } else {
            printRankingList(result.getData());
            process.stdout.write(formatPageFooter(result, 'assets'));
          }
        } catch (err) {
          printError(formatError(err));
          process.exit(1);
        }
      },
    );

  command
    .command('recompute')
    .description(
      "Recompute all hamming-comparison duplicate data for a project's configured recipes " +
        '(e.g. after changing --hamming-threshold). Exact-comparison recipes are skipped — ' +
        'they never depend on the threshold.',
    )
    .requiredOption('--project <slug>', 'Project slug')
    .option(
      '--batch-size <n>',
      `Assets processed per batch (default: ${String(DEFAULT_RECOMPUTE_BATCH_SIZE)}, max ${String(MAX_RECOMPUTE_BATCH_SIZE)})`,
    )
    .action(async (opts: { project: string; batchSize?: string }) => {
      const { commandGateway, projects, algorithms, config } = getCradle();

      try {
        const project = await projects.getBySlug(opts.project);
        const batchSize = Math.min(
          parsePositiveInt(opts.batchSize, DEFAULT_RECOMPUTE_BATCH_SIZE, 'batch-size'),
          MAX_RECOMPUTE_BATCH_SIZE,
        );
        const displayThreshold = project.hammingThreshold ?? config.default_hamming_threshold;

        const hammingRecipes: { recipe: string; algorithm: Algorithm }[] = [];

        for (const recipe of project.recipes) {
          const algorithm = await algorithms.findByRecipe(recipe);

          if (algorithm?.comparison === Comparison.HAMMING) {
            hammingRecipes.push({ recipe, algorithm });
          }
        }

        if (hammingRecipes.length === 0) {
          printError(msg.NO_HAMMING_RECIPES);
          process.exit(1);

          return;
        }

        for (const { recipe, algorithm } of hammingRecipes) {
          process.stdout.write(msg.recomputingLine(recipe, displayThreshold));

          const total = await commandGateway.dispatch(
            new RecomputeProject(
              project.id,
              algorithm.id,
              algorithm.comparison,
              project.hammingThreshold,
              batchSize,
              (done) => {
                process.stdout.write(msg.batchProgressLine(done));
              },
            ),
          );

          process.stdout.write(msg.recomputeDoneLine(total, recipe));
        }
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  return command;
}
