import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatError,
  printJson,
  printTable,
  printSuccess,
  printError,
  formatIdentity,
} from '../../../../src/presentation/cli/output.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatError', () => {
  it('stringifies a non-Error value', () => {
    expect(formatError('plain string')).toBe('plain string');
    expect(formatError(42)).toBe('42');
    expect(formatError(null)).toBe('null');
  });

  it("returns an Error's own message when it has no cause", () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('walks the .cause chain, joining each message', () => {
    const root = new Error('root cause');
    const middle = new Error('middle failure', { cause: root });
    const top = new Error('top-level failure', { cause: middle });

    expect(formatError(top)).toBe('top-level failure — caused by: middle failure — caused by: root cause');
  });

  it('stops walking once .cause is not an Error', () => {
    const err = new Error('failure', { cause: 'not an error' });

    expect(formatError(err)).toBe('failure');
  });
});

describe('printJson', () => {
  it('writes pretty-printed JSON to stdout', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printJson({ a: 1 });

    expect(write).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2) + '\n');
  });
});

describe('printTable', () => {
  it('writes "(no results)" for an empty row set', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printTable([], ['id', 'name']);

    expect(write).toHaveBeenCalledWith('(no results)\n');
  });

  it('renders a header, separator, and padded rows', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printTable(
      [
        { id: '1', name: 'alice' },
        { id: '22', name: 'bo' },
      ],
      ['id', 'name'],
    );

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('id  name');
    expect(output).toContain('--  -----');
    expect(output).toContain('1   alice');
    expect(output).toContain('22  bo');
  });

  it('renders an empty string for a missing/null/undefined cell value', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printTable([{ id: '1', name: null, extra: undefined }], ['id', 'name', 'extra']);

    const output = write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('id  name  extra');
  });
});

describe('printSuccess', () => {
  it('writes the message with a trailing newline to stdout', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printSuccess('done');

    expect(write).toHaveBeenCalledWith('done\n');
  });
});

describe('printError', () => {
  it('writes an "Error: " prefixed message to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    printError('boom');

    expect(write).toHaveBeenCalledWith('Error: boom\n');
  });
});

describe('formatIdentity', () => {
  it('formats an id-only identity', () => {
    expect(formatIdentity({ id: 'a1', path: null })).toBe('id=a1');
  });

  it('formats a path-only identity', () => {
    expect(formatIdentity({ id: null, path: '/some/path.jpg' })).toBe('path=/some/path.jpg');
  });

  it('formats an identity with both id and path', () => {
    expect(formatIdentity({ id: 'a1', path: '/some/path.jpg' })).toBe('id=a1, path=/some/path.jpg');
  });
});
