import { describe, it, expect } from 'vitest';
import { ConfigError } from '../../../../src/infrastructure/config/errors.js';

describe('ConfigError', () => {
  it('sets message, name, and Error prototype chain', () => {
    const err = ConfigError.missingConfigPathEnv();

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('CONFIG_PATH environment variable must be set');
    expect(err.name).toBe('ConfigError');
  });

  it('carries an optional cause', () => {
    const cause = new Error('root cause');
    const err = ConfigError.fileReadFailed('/etc/config.yaml', cause);

    expect(err.cause).toBe(cause);
  });

  it('formats the schema-invalid message with the config path and zod details', () => {
    const err = ConfigError.schemaInvalid('/etc/config.yaml', 'default_hamming_threshold: Required');

    expect(err.message).toBe('invalid config at /etc/config.yaml:\ndefault_hamming_threshold: Required');
  });

  it('formats the missing DATABASE_URL message', () => {
    const err = ConfigError.missingDatabaseUrlEnv();

    expect(err.message).toBe('DATABASE_URL environment variable must be set');
  });
});
