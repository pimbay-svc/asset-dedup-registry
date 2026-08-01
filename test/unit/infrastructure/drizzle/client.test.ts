import { describe, it, expect, vi, type MockInstance } from 'vitest';
import pino, { type Logger } from 'pino';
import type { Sql } from 'postgres';
import { handlePoolClose } from '../../../../src/infrastructure/drizzle/client.js';

function buildLogger(): { logger: Logger; debugSpy: MockInstance } {
  const logger = pino({ level: 'silent' });
  const debugSpy = vi.spyOn(logger, 'debug');

  return { logger, debugSpy };
}

describe('handlePoolClose', () => {
  it('logs at debug when the close was not marked intentional', () => {
    const { logger, debugSpy } = buildLogger();
    const client = {} as Sql;

    handlePoolClose('conn-1', client, new WeakSet(), logger);

    expect(debugSpy).toHaveBeenCalledWith({ connId: 'conn-1' }, 'pool connection closed');
  });

  it('does not log when the client is in the intentional-closes set (closeDbClient)', () => {
    const { logger, debugSpy } = buildLogger();
    const client = {} as Sql;
    const intentionalCloses = new WeakSet<Sql>([client]);

    handlePoolClose('conn-1', client, intentionalCloses, logger);

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('does not confuse two different clients sharing one intentional-closes set', () => {
    const { logger, debugSpy } = buildLogger();
    const closingClient = {} as Sql;
    const otherClient = {} as Sql;
    const intentionalCloses = new WeakSet<Sql>([closingClient]);

    handlePoolClose('conn-2', otherClient, intentionalCloses, logger);

    expect(debugSpy).toHaveBeenCalledWith({ connId: 'conn-2' }, 'pool connection closed');
  });
});
