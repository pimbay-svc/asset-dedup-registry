/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { Command } from 'commander';
import { printJson, printTable, printSuccess, printError, formatError } from '../output.js';
import type { Cradle } from '../../../infrastructure/container.js';
import { CreateProject, UpdateProjectSettings, DeleteProject } from '../../../application/command/project.command.js';
import { ProjectMessages as msg } from '../messages.js';

function parseRecipes(raw: string): string[] {
  return raw
    .split(',')
    .map((recipe) => recipe.trim())
    .filter((recipe) => recipe.length > 0);
}

function formatHammingThreshold(value: number | null): string {
  return value === null ? '' : value.toFixed(2);
}

function formatRateLimit(value: number | null): string {
  return value === null ? '' : String(value);
}

const PROJECT_TABLE_COLUMNS = ['id', 'slug', 'name', 'recipes', 'hamming_threshold', 'rate_limit_per_minute'];

function toProjectRow(p: {
  id: string;
  slug: string;
  name: string;
  recipes: string[];
  hammingThreshold: number | null;
  rateLimitPerMinute: number | null;
}): Record<string, string> {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    recipes: p.recipes.join(', '),
    hamming_threshold: formatHammingThreshold(p.hammingThreshold),
    rate_limit_per_minute: formatRateLimit(p.rateLimitPerMinute),
  };
}

export function buildProjectCommand(getCradle: () => Cradle): Command {
  const command = new Command('project').description('Manage projects (tenants)');

  command
    .command('create')
    .description('Create a new project')
    .requiredOption('--slug <slug>', 'Unique project slug (e.g. pimbay-main)')
    .requiredOption('--name <n>', 'Human-readable project name')
    .requiredOption(
      '--recipes <recipes>',
      'Comma-separated recipes, must include at least one binary.* (e.g. binary.sha256,image.phash8)',
    )
    .option(
      '--hamming-threshold <threshold>',
      'Minimum similarity % (0-100) for hamming duplicates — defaults to config.yaml if omitted',
    )
    .option('--rate-limit <n>', "Requests/minute for this project's API keys — defaults to config.yaml if omitted")
    .option('--json', 'Output as JSON')
    .action(
      async (opts: {
        slug: string;
        name: string;
        recipes: string;
        hammingThreshold?: string;
        rateLimit?: string;
        json?: boolean;
      }) => {
        const { commandGateway } = getCradle();

        try {
          const recipes = parseRecipes(opts.recipes);
          const hammingThreshold =
            opts.hammingThreshold !== undefined ? Number.parseFloat(opts.hammingThreshold) : null;
          const rateLimitPerMinute = opts.rateLimit !== undefined ? Number.parseInt(opts.rateLimit, 10) : null;

          const p = await commandGateway.dispatch(
            new CreateProject(opts.slug, opts.name, recipes, hammingThreshold, rateLimitPerMinute),
          );

          if (opts.json === true) {
            printJson(p);
          } else {
            printTable([toProjectRow(p)], PROJECT_TABLE_COLUMNS);
          }
        } catch (err) {
          printError(formatError(err));
          process.exit(1);
        }
      },
    );

  command
    .command('update')
    .description("Update a project's recipes and/or hamming threshold")
    .requiredOption('--slug <slug>', 'Project slug')
    .option('--recipes <recipes>', 'Comma-separated recipes, must include at least one binary.*')
    .option(
      '--hamming-threshold <threshold>',
      'Minimum similarity % (0-100) for hamming duplicates, or "none" to clear back to the config default',
    )
    .option(
      '--rate-limit <n>',
      'Requests/minute for this project\'s API keys, or "none" to clear back to the config default',
    )
    .option('--json', 'Output as JSON')
    .action(
      async (opts: {
        slug: string;
        recipes?: string;
        hammingThreshold?: string;
        rateLimit?: string;
        json?: boolean;
      }) => {
        const { commandGateway, projects } = getCradle();

        try {
          const project = await projects.getBySlug(opts.slug);
          const recipes = opts.recipes !== undefined ? parseRecipes(opts.recipes) : undefined;
          const hammingThreshold =
            opts.hammingThreshold === undefined
              ? undefined
              : opts.hammingThreshold === 'none'
                ? null
                : Number.parseFloat(opts.hammingThreshold);
          const rateLimitPerMinute =
            opts.rateLimit === undefined
              ? undefined
              : opts.rateLimit === 'none'
                ? null
                : Number.parseInt(opts.rateLimit, 10);

          const p = await commandGateway.dispatch(
            new UpdateProjectSettings(project.id, recipes, hammingThreshold, rateLimitPerMinute),
          );

          if (opts.json === true) {
            printJson(p);
          } else {
            printTable([toProjectRow(p)], PROJECT_TABLE_COLUMNS);
          }
        } catch (err) {
          printError(formatError(err));
          process.exit(1);
        }
      },
    );

  command
    .command('list')
    .description('List all projects')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { projects } = getCradle();

      try {
        const rows = await projects.list();

        if (opts.json === true) {
          printJson(rows);
        } else {
          printTable(rows.map(toProjectRow), PROJECT_TABLE_COLUMNS);
        }
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  command
    .command('delete')
    .description('Permanently delete a project and everything under it (assets, hashes, duplicate data, api clients)')
    .requiredOption('--slug <slug>', 'Project slug')
    .option('--yes', 'Actually perform the deletion (without this, only prints what would be deleted)')
    .action(async (opts: { slug: string; yes?: boolean }) => {
      const { commandGateway, projects, assets, apiClients } = getCradle();

      try {
        const project = await projects.getBySlug(opts.slug);
        const [assetCount, apiClientRows] = await Promise.all([
          assets.countByProject(project.id),
          apiClients.listByProject(project.id),
        ]);

        if (opts.yes !== true) {
          printError(msg.confirmDelete(opts.slug, assetCount, apiClientRows.length));
          process.exit(1);

          return;
        }

        await commandGateway.dispatch(new DeleteProject(project.id));
        printSuccess(msg.deleted(opts.slug, assetCount, apiClientRows.length));
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  return command;
}
