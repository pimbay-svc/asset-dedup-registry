import { describe, it, expect } from 'vitest';
import { NodeEnv, loadEnv } from '../../../../src/infrastructure/env/env.js';
import { EnvError } from '../../../../src/infrastructure/env/errors.js';

describe('NodeEnv', () => {
  it('exposes the expected constant values', () => {
    expect(NodeEnv.PRODUCTION).toBe('production');
    expect(NodeEnv.DEVELOPMENT).toBe('development');
    expect(NodeEnv.TEST).toBe('test');
  });
});

describe('loadEnv', () => {
  it('applies defaults when only required-less fields are given', () => {
    const env = loadEnv({});

    expect(env.NODE_ENV).toBe(NodeEnv.PRODUCTION);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.PORT).toBe(3100);
  });

  it('parses provided values, coercing PORT from string', () => {
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'debug', PORT: '4000' });

    expect(env).toEqual({ NODE_ENV: NodeEnv.TEST, LOG_LEVEL: 'debug', PORT: 4000 });
  });

  it('throws an EnvError for an invalid NODE_ENV', () => {
    expect(() => loadEnv({ NODE_ENV: 'staging' })).toThrow(EnvError);
  });

  it('throws an EnvError for a non-positive PORT', () => {
    expect(() => loadEnv({ PORT: '-1' })).toThrow(EnvError);
  });
});
