import { describe, it, expect } from 'vitest';
import { resolveTransport, createLoggerOptions } from '../../../src/infrastructure/logger.js';
import { NodeEnv, loadEnv } from '../../../src/infrastructure/env/env.js';

function envWith(nodeEnv: NodeEnv, logLevel = 'info'): ReturnType<typeof loadEnv> {
  return loadEnv({ NODE_ENV: nodeEnv, LOG_LEVEL: logLevel });
}

describe('resolveTransport', () => {
  it('returns undefined in production (structured JSON to stdout)', () => {
    expect(resolveTransport(envWith(NodeEnv.PRODUCTION))).toBeUndefined();
  });

  it('writes to a file in test', () => {
    expect(resolveTransport(envWith(NodeEnv.TEST))).toEqual({
      target: 'pino/file',
      options: { destination: 'var/logs/test.log', mkdir: true },
    });
  });

  it('uses pino-pretty in development', () => {
    expect(resolveTransport(envWith(NodeEnv.DEVELOPMENT))).toEqual({ target: 'pino-pretty' });
  });
});

describe('createLoggerOptions', () => {
  it('uses the given LOG_LEVEL', () => {
    expect(createLoggerOptions(envWith(NodeEnv.PRODUCTION, 'debug')).level).toBe('debug');
  });

  it('defaults level to info when LOG_LEVEL is unset', () => {
    expect(createLoggerOptions(loadEnv({ NODE_ENV: NodeEnv.PRODUCTION })).level).toBe('info');
  });

  it('includes the resolved transport', () => {
    expect(createLoggerOptions(envWith(NodeEnv.PRODUCTION)).transport).toBeUndefined();
  });
});
