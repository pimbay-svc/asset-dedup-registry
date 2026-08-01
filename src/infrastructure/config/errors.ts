/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
export class ConfigError extends Error {
  private constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigError';
  }

  /** `config.yaml` failed `ConfigSchema.safeParse` — zod's own formatted error report. */
  static schemaInvalid(configPath: string, zodErrorDetails: string): ConfigError {
    return new ConfigError(`invalid config at ${configPath}:\n${zodErrorDetails}`);
  }

  static missingConfigPathEnv(): ConfigError {
    return new ConfigError('CONFIG_PATH environment variable must be set');
  }

  static missingDatabaseUrlEnv(): ConfigError {
    return new ConfigError('DATABASE_URL environment variable must be set');
  }

  static fileReadFailed(configPath: string, cause: unknown): ConfigError {
    return new ConfigError(`failed to read config file at ${configPath}: ${(cause as Error).message}`, { cause });
  }

  static yamlParseFailed(configPath: string, cause: unknown): ConfigError {
    return new ConfigError(`failed to parse YAML config at ${configPath}: ${(cause as Error).message}`, { cause });
  }
}
