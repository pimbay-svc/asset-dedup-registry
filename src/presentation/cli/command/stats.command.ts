/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { Command } from 'commander';
import { printJson, printTable, printError, formatError } from '../output.js';
import type { Cradle } from '../../../infrastructure/container.js';

/** Read-only, derived view — kept separate from `project` (config). Counting lives in `ProjectStatsService` */
export function buildStatsCommand(getCradle: () => Cradle): Command {
  const command = new Command('stats').description('Aggregate statistics across projects');

  command
    .command('projects')
    .description('Per-project asset and duplicate-pair counts')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { projects, projectStatsService } = getCradle();

      try {
        const projectRows = await projects.list();

        const rows = await Promise.all(
          projectRows.map(async (project) => {
            const overview = await projectStatsService.getOverview(project);

            return {
              slug: overview.slug,
              name: overview.name,
              assets: overview.assets,
              duplicate_pairs: overview.duplicatePairs,
            };
          }),
        );

        if (opts.json === true) {
          printJson(rows);
        } else {
          printTable(rows, ['slug', 'name', 'assets', 'duplicate_pairs']);
        }
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  return command;
}
