/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema, type Config, type DatabaseConfig } from './types.js';
import { ConfigError } from './errors.js';

export function loadConfig(configPath: string): Config {
  const raw = readConfigFile(configPath);
  const parsed = parseConfigYaml(raw, configPath);

  const result = ConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw ConfigError.schemaInvalid(configPath, result.error.toString());
  }

  return result.data;
}

function readConfigFile(configPath: string): string {
  try {
    return readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw ConfigError.fileReadFailed(configPath, err);
  }
}

function parseConfigYaml(raw: string, configPath: string): unknown {
  try {
    return parseYaml(raw);
  } catch (err) {
    throw ConfigError.yamlParseFailed(configPath, err);
  }
}

export function resolveConfigPath(): string {
  const configPath = process.env.CONFIG_PATH;

  if (configPath === undefined || configPath.length === 0) {
    throw ConfigError.missingConfigPathEnv();
  }

  return configPath;
}

export function resolveDatabaseConfig(config: Config): DatabaseConfig {
  const url = process.env.DATABASE_URL;

  if (url === undefined || url.length === 0) {
    throw ConfigError.missingDatabaseUrlEnv();
  }

  return { url, pool_size: config.database.pool_size };
}
