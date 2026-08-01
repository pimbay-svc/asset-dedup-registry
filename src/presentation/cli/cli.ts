#!/usr/bin/env node
/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { Command } from 'commander';
import { loadEnv } from '../../infrastructure/env/env.js';
import { loadConfig, resolveConfigPath } from '../../infrastructure/config/config.js';
import { buildContainer, type Cradle } from '../../infrastructure/container.js';
import { SERVICE_VERSION } from '../../infrastructure/version.js';
import { buildProjectCommand } from './command/project.command.js';
import { buildApiClientCommand } from './command/apiClient.command.js';
import { buildAssetCommand } from './command/asset.command.js';
import { buildDuplicatesCommand } from './command/duplicate.command.js';
import { buildStatsCommand } from './command/stats.command.js';

function createCradleGetter(): { getCradle: () => Cradle; cleanup: () => Promise<void> } {
  let built: ReturnType<typeof buildContainer> | undefined;

  const getCradle = (): Cradle => {
    if (built === undefined) {
      const env = loadEnv();
      const config = loadConfig(resolveConfigPath());
      built = buildContainer(env, config);
    }

    return built.container.cradle;
  };

  const cleanup = async (): Promise<void> => {
    if (built !== undefined) {
      await built.cleanup();
    }
  };

  return { getCradle, cleanup };
}

async function main(): Promise<void> {
  const { getCradle, cleanup } = createCradleGetter();

  const program = new Command();
  program.name('asset-dedup-registry-cli').description('CLI for asset-dedup-registry').version(SERVICE_VERSION);

  program.addCommand(buildProjectCommand(getCradle));
  program.addCommand(buildApiClientCommand(getCradle));
  program.addCommand(buildAssetCommand(getCradle));
  program.addCommand(buildDuplicatesCommand(getCradle));
  program.addCommand(buildStatsCommand(getCradle));

  try {
    await program.parseAsync(process.argv);
  } finally {
    await cleanup();
  }
}

main().catch((err: unknown) => {
  process.stderr.write('Fatal: ' + String(err) + '\n');
  process.exit(1);
});
