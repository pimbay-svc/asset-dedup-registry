import { describe, it, expect } from 'vitest';
import {
  parsePositiveInt,
  parseOptionalLimit,
  parsePercentage,
  parsePage,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../../src/presentation/parse.js';
import { ValidationError } from '../../../src/domain/errors.js';

describe('parsePositiveInt', () => {
  it('returns the default when raw is undefined', () => {
    expect(parsePositiveInt(undefined, 20, 'page-size')).toBe(20);
  });

  it('parses a positive integer', () => {
    expect(parsePositiveInt('7', 20, 'page-size')).toBe(7);
  });

  it('rejects zero, including the field name in the message', () => {
    expect(() => parsePositiveInt('0', 20, 'page-size')).toThrow(/page-size/);
  });

  it('rejects a non-numeric value', () => {
    expect(() => parsePositiveInt('abc', 20, 'page-size')).toThrow(ValidationError);
  });
});

describe('parseOptionalLimit', () => {
  it('returns undefined when raw is undefined', () => {
    expect(parseOptionalLimit(undefined)).toBeUndefined();
  });

  it('parses a positive integer', () => {
    expect(parseOptionalLimit('5')).toBe(5);
  });

  it('rejects zero', () => {
    expect(() => parseOptionalLimit('0')).toThrow(ValidationError);
  });

  it('defaults the field name in the message to "limit"', () => {
    expect(() => parseOptionalLimit('0')).toThrow(/limit/);
  });

  it('rejects a non-numeric value', () => {
    expect(() => parseOptionalLimit('abc')).toThrow(ValidationError);
  });
});

describe('parsePercentage', () => {
  it('returns the fallback when raw is undefined', () => {
    expect(parsePercentage(undefined, 90)).toBe(90);
  });

  it('parses a valid raw string', () => {
    expect(parsePercentage('42.5', 90)).toBe(42.5);
  });

  it('rejects an out-of-range value', () => {
    expect(() => parsePercentage('101', 90)).toThrow(ValidationError);
  });

  it('names the field as "threshold" in the out-of-range message', () => {
    expect(() => parsePercentage('101', 90)).toThrow(/threshold/);
  });

  it('rejects a non-numeric value', () => {
    expect(() => parsePercentage('abc', 90)).toThrow(ValidationError);
  });
});

describe('parsePage', () => {
  it('defaults to page 1 and DEFAULT_PAGE_SIZE when nothing is given', () => {
    expect(parsePage({})).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
  });

  it('parses explicit page/pageSize', () => {
    expect(parsePage({ page: '2', pageSize: '5' })).toEqual({ page: 2, size: 5 });
  });

  it('accepts pageSize at exactly MAX_PAGE_SIZE', () => {
    expect(parsePage({ pageSize: String(MAX_PAGE_SIZE) })).toEqual({ page: 1, size: MAX_PAGE_SIZE });
  });

  it('rejects pageSize above MAX_PAGE_SIZE', () => {
    expect(() => parsePage({ pageSize: '500' })).toThrow(ValidationError);
  });

  it('names the pageSize field in the exceeds-maximum message', () => {
    expect(() => parsePage({ pageSize: '500' }, 'page-size')).toThrow(/page-size/);
  });

  it('rejects a zero/negative page', () => {
    expect(() => parsePage({ page: '0' })).toThrow(ValidationError);
  });

  it('names the field as "page" (not the pageSize field name) when page itself is invalid', () => {
    expect(() => parsePage({ page: '0' }, 'page-size')).toThrow('page must be a positive integer');
  });

  it('uses the given field name in the pageSize error message', () => {
    expect(() => parsePage({ pageSize: '0' }, 'page-size')).toThrow(/page-size/);
  });

  it('defaults the pageSize error field name to page_size', () => {
    expect(() => parsePage({ pageSize: '0' })).toThrow(/page_size/);
  });
});
