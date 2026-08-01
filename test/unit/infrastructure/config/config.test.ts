import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, resolveConfigPath, resolveDatabaseConfig } from '../../../../src/infrastructure/config/config.js';
import { ConfigError } from '../../../../src/infrastructure/config/errors.js';

let tmpDir: string | undefined;

function writeConfig(yaml: string): string {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'asset-dedup-registry-test-'));
  const configPath = path.join(tmpDir, 'config.yaml');
  writeFileSync(configPath, yaml, 'utf-8');

  return configPath;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

const VALID_CONFIG = `
core_base_url: http://asset-dedup-core:3000
core_timeout_ms: 10000
default_hamming_threshold: 90
database:
  pool_size: 5
`;

describe('loadConfig', () => {
  it('loads and returns a valid config', () => {
    const configPath = writeConfig(VALID_CONFIG);
    const config = loadConfig(configPath);

    expect(config.default_hamming_threshold).toBe(90);
    expect(config.database.pool_size).toBe(5);
  });

  it('applies the default core_timeout_ms when omitted', () => {
    const configPath = writeConfig(`
core_base_url: http://asset-dedup-core:3000
default_hamming_threshold: 90
database:
  pool_size: 5
`);
    const config = loadConfig(configPath);
    expect(config.core_timeout_ms).toBe(10000);
  });

  it('applies the default database.pool_size when omitted', () => {
    const configPath = writeConfig(`
core_base_url: http://asset-dedup-core:3000
default_hamming_threshold: 90
database: {}
`);
    const config = loadConfig(configPath);
    expect(config.database.pool_size).toBe(10);
  });

  it('throws a ConfigError when the config file does not exist', () => {
    expect(() => loadConfig('/nonexistent/path/config.yaml')).toThrow(ConfigError);
    expect(() => loadConfig('/nonexistent/path/config.yaml')).toThrow(/failed to read config file/);
  });

  it('throws a ConfigError when the file is not valid YAML', () => {
    const configPath = writeConfig('core_base_url: [unterminated');
    expect(() => loadConfig(configPath)).toThrow(/failed to parse YAML config/);
  });

  it('throws a ConfigError when core_base_url is not a valid URL', () => {
    const configPath = writeConfig(`
core_base_url: not-a-url
default_hamming_threshold: 90
database:
  pool_size: 5
`);
    expect(() => loadConfig(configPath)).toThrow(/invalid config/);
  });

  it('throws a ConfigError when default_hamming_threshold is missing', () => {
    const configPath = writeConfig(`
core_base_url: http://asset-dedup-core:3000
database:
  pool_size: 5
`);
    expect(() => loadConfig(configPath)).toThrow(/invalid config/);
  });

  it('throws a ConfigError when default_hamming_threshold is out of range', () => {
    const configPath = writeConfig(`
core_base_url: http://asset-dedup-core:3000
default_hamming_threshold: 150
database:
  pool_size: 5
`);
    expect(() => loadConfig(configPath)).toThrow(/invalid config/);
  });
});

describe('resolveConfigPath', () => {
  const originalEnv = process.env.CONFIG_PATH;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = originalEnv;
    }
  });

  it('returns CONFIG_PATH when set', () => {
    process.env.CONFIG_PATH = '/some/config.yaml';
    expect(resolveConfigPath()).toBe('/some/config.yaml');
  });

  it('throws when CONFIG_PATH is unset', () => {
    delete process.env.CONFIG_PATH;
    expect(() => resolveConfigPath()).toThrow(ConfigError);
  });

  it('throws when CONFIG_PATH is empty', () => {
    process.env.CONFIG_PATH = '';
    expect(() => resolveConfigPath()).toThrow(ConfigError);
  });
});

describe('resolveDatabaseConfig', () => {
  const originalEnv = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalEnv;
    }
  });

  it('returns the url and pool_size when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://localhost/db';
    const configPath = writeConfig(VALID_CONFIG);
    const config = loadConfig(configPath);

    expect(resolveDatabaseConfig(config)).toEqual({ url: 'postgres://localhost/db', pool_size: 5 });
  });

  it('throws when DATABASE_URL is unset', () => {
    const configPath = writeConfig(VALID_CONFIG);
    const config = loadConfig(configPath);

    expect(() => resolveDatabaseConfig(config)).toThrow(ConfigError);
  });

  it('throws when DATABASE_URL is empty', () => {
    process.env.DATABASE_URL = '';
    const configPath = writeConfig(VALID_CONFIG);
    const config = loadConfig(configPath);

    expect(() => resolveDatabaseConfig(config)).toThrow(ConfigError);
  });
});
