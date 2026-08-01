/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import fg from 'fast-glob';
import { printJson, printTable, printSuccess, printError, formatError, formatIdentity } from '../output.js';
import type { Cradle } from '../../../infrastructure/container.js';
import { AddAsset, DeleteAsset } from '../../../application/command/asset.command.js';
import { AssetAddStatus, MimeHintType, Identity, type MimeHint } from '../../../domain/model/asset.model.js';
import { AssetMessages as msg } from '../messages.js';

function readFileAsBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
}

function deriveMimeHint(filePath: string): MimeHint {
  const extension = path.extname(filePath).replace(/^\./, '');

  if (extension === '') {
    throw new Error(msg.noExtension(filePath));
  }

  return { type: MimeHintType.EXTENSION, value: extension };
}

export function buildAssetCommand(getCradle: () => Cradle): Command {
  const command = new Command('asset').description(
    'Hash and manage assets directly (no API client / bearer token needed)',
  );

  command
    .command('add')
    .description(
      'Hash a single local file and add it as an asset (re-running on the same identity updates it) — ' +
        'at least one of --id/--path is required',
    )
    .requiredOption('--project <slug>', 'Project slug')
    .option('--id <id>', 'Asset identity id (opaque to the registry — your own external id)')
    .option('--path <path>', 'Asset identity path (supports partial search, unlike --id)')
    .requiredOption('--file <path>', 'Path to the local file to hash')
    .option('--json', 'Output as JSON')
    .action(async (opts: { project: string; id?: string; path?: string; file: string; json?: boolean }) => {
      const { commandGateway, projects } = getCradle();

      try {
        const project = await projects.getBySlug(opts.project);
        const mimeHint = deriveMimeHint(opts.file);
        const fileContentBase64 = readFileAsBase64(opts.file);

        const result = await commandGateway.dispatch(
          new AddAsset(project.id, opts.id ?? null, opts.path ?? null, mimeHint, fileContentBase64),
        );

        if (opts.json === true) {
          printJson(result);
        } else {
          printTable(
            result.results.map((r) => ({ recipe: r.recipe, hashes: r.hashes.join(', '), status: r.status })),
            ['recipe', 'hashes', 'status'],
          );
        }
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  command
    .command('scan')
    .description('Hash every file under a local directory and add/update them as assets, in one process/DB connection')
    .requiredOption('--project <slug>', 'Project slug')
    .requiredOption('--root <path>', 'Directory to scan')
    .option(
      '--include <glob>',
      'Glob pattern relative to --root, repeatable (default: **/*, everything)',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option(
      '--path-prefix <prefix>',
      'Prefix asset paths with this instead of using the absolute local path (e.g. "s3://my-bucket/" if this local copy mirrors an S3 layout)',
    )
    .option('--json', 'Output as JSON summary')
    .action(async (opts: { project: string; root: string; include: string[]; pathPrefix?: string; json?: boolean }) => {
      const { commandGateway, projects } = getCradle();

      try {
        const project = await projects.getBySlug(opts.project);
        const root = path.resolve(opts.root);
        const patterns = opts.include.length > 0 ? opts.include : ['**/*'];

        const relativePaths = await fg(patterns, { cwd: root, onlyFiles: true, dot: false });

        if (relativePaths.length === 0) {
          printError(msg.noFilesMatched(root, patterns.join(', ')));
          process.exit(1);

          return;
        }

        const summary = { created: 0, updated: 0, unchanged: 0, failed: 0 };
        const failures: { path: string; error: string }[] = [];

        for (const relativePath of relativePaths) {
          const identityPath =
            opts.pathPrefix !== undefined ? opts.pathPrefix + relativePath : path.join(root, relativePath);

          try {
            const filePath = path.join(root, relativePath);
            const mimeHint = deriveMimeHint(filePath);
            const fileContentBase64 = readFileAsBase64(filePath);
            const result = await commandGateway.dispatch(
              new AddAsset(project.id, null, identityPath, mimeHint, fileContentBase64),
            );

            const worst: 'created' | 'updated' | 'unchanged' = result.results.some(
              (r) => r.status === AssetAddStatus.CREATED,
            )
              ? 'created'
              : result.results.some((r) => r.status === AssetAddStatus.UPDATED)
                ? 'updated'
                : 'unchanged';

            summary[worst] += 1;
            process.stdout.write(msg.scanLine(worst, identityPath));
          } catch (err) {
            summary.failed += 1;
            const message = err instanceof Error ? err.message : String(err);
            failures.push({ path: identityPath, error: message });
            process.stdout.write(msg.scanFailedLine(identityPath, message));
          }
        }

        if (opts.json === true) {
          printJson({ total: relativePaths.length, ...summary, failures });
        } else {
          printSuccess(
            msg.scanSummary(relativePaths.length, summary.created, summary.updated, summary.unchanged, summary.failed),
          );
        }

        if (summary.failed > 0) {
          process.exit(1);
        }
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  command
    .command('delete')
    .description('Delete an asset (and its hashes/duplicate edges) — at least one of --id/--path is required')
    .requiredOption('--project <slug>', 'Project slug')
    .option('--id <id>', 'Asset identity id')
    .option('--path <path>', 'Asset identity path')
    .action(async (opts: { project: string; id?: string; path?: string }) => {
      const { commandGateway, projects } = getCradle();

      try {
        const project = await projects.getBySlug(opts.project);
        const identity = new Identity(opts.id ?? null, opts.path ?? null);

        await commandGateway.dispatch(new DeleteAsset(project.id, identity));
        printSuccess(msg.deleted(formatIdentity(identity)));
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  command
    .command('recipes')
    .description(
      'List which recipes have actually been computed for a given asset — at least one of --id/--path is required',
    )
    .requiredOption('--project <slug>', 'Project slug')
    .option('--id <id>', 'Asset identity id')
    .option('--path <path>', 'Asset identity path')
    .option('--json', 'Output as JSON')
    .action(async (opts: { project: string; id?: string; path?: string; json?: boolean }) => {
      const { projects, assets } = getCradle();

      try {
        const project = await projects.getBySlug(opts.project);
        const identity = new Identity(opts.id ?? null, opts.path ?? null);
        const recipes = await assets.listRecipes(project.id, identity);

        if (opts.json === true) {
          printJson({ identity, recipes });
        } else {
          printTable(
            recipes.map((recipe) => ({ recipe })),
            ['recipe'],
          );
        }
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  return command;
}
