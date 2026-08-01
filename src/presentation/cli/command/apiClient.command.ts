/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { Command } from 'commander';
import { printJson, printTable, printError, printSuccess, formatError } from '../output.js';
import { ApiScope } from '../../../domain/model/apiClient.model.js';
import type { Cradle } from '../../../infrastructure/container.js';
import { CreateApiClient, RevokeApiClient } from '../../../application/command/apiClient.command.js';
import { ApiClientMessages as msg } from '../messages.js';

const VALID_SCOPES = new Set<string>(Object.values(ApiScope));

export function buildApiClientCommand(getCradle: () => Cradle): Command {
  const command = new Command('api-client').description('Manage API clients (application keys)');

  command
    .command('create')
    .description('Create a new API client and print the key (shown ONCE)')
    .requiredOption('--project <slug>', 'Project slug')
    .requiredOption('--name <n>', 'Client name (e.g. pimcore-prod)')
    .requiredOption('--scopes <scopes>', `Comma-separated scopes (${Object.values(ApiScope).join(', ')})`)
    .option('--json', 'Output as JSON')
    .action(async (opts: { project: string; name: string; scopes: string; json?: boolean }) => {
      const { commandGateway, projects } = getCradle();

      try {
        const project = await projects.getBySlug(opts.project);
        const scopes = opts.scopes
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const invalidScopes = scopes.filter((s) => !VALID_SCOPES.has(s));

        if (invalidScopes.length > 0) {
          printError(msg.invalidScopes(invalidScopes.join(', '), [...VALID_SCOPES].join(', ')));
          process.exit(1);

          return;
        }

        const { apiClient, rawKey } = await commandGateway.dispatch(
          new CreateApiClient(project.id, opts.name, scopes as ApiScope[]),
        );

        if (opts.json === true) {
          printJson({ ...apiClient, api_key: rawKey });
        } else {
          printTable([{ id: apiClient.id, name: apiClient.name, scopes: scopes.join(', ') }], ['id', 'name', 'scopes']);
          // Key shown once — prominent warning
          process.stdout.write(msg.rawKeyBlock(rawKey));
        }
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  command
    .command('list')
    .description('List API clients for a project')
    .requiredOption('--project <slug>', 'Project slug')
    .option('--json', 'Output as JSON')
    .action(async (opts: { project: string; json?: boolean }) => {
      const { apiClients, projects } = getCradle();

      try {
        const project = await projects.getBySlug(opts.project);
        const rows = await apiClients.listByProject(project.id);

        if (opts.json === true) {
          printJson(rows);
        } else {
          printTable(
            rows.map((r) => ({
              id: r.id,
              name: r.name,
              scopes: r.scopes.join(', '),
              revoked: r.revokedAt !== null ? r.revokedAt.toISOString() : '',
            })),
            ['id', 'name', 'scopes', 'revoked'],
          );
        }
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  command
    .command('revoke')
    .description('Revoke an API client by ID')
    .requiredOption('--id <id>', 'API client UUID')
    .action(async (opts: { id: string }) => {
      const { commandGateway } = getCradle();

      try {
        await commandGateway.dispatch(new RevokeApiClient(opts.id));
        printSuccess(msg.revoked(opts.id));
      } catch (err) {
        printError(formatError(err));
        process.exit(1);
      }
    });

  return command;
}
