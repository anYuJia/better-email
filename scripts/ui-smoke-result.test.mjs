import { describe, expect, it } from 'vitest';
import { smokePassed } from './ui-smoke-result.mjs';

describe('UI smoke completion', () => {
  const success = { successSeen: true, failureSeen: false, forcedAfterSuccess: false, code: 0 };
  it('requires a success marker and a successful exit', () => {
    expect(smokePassed(success)).toBe(true);
    expect(smokePassed({ ...success, successSeen: false })).toBe(false);
    expect(smokePassed({ ...success, code: 1 })).toBe(false);
    expect(smokePassed({ ...success, failureSeen: true })).toBe(false);
  });
  it('allows intentional cleanup only after a successful run', () => {
    expect(smokePassed({ ...success, code: null, forcedAfterSuccess: true })).toBe(true);
    expect(smokePassed({ ...success, successSeen: false, code: null, forcedAfterSuccess: true })).toBe(false);
    expect(smokePassed({ ...success, failureSeen: true, code: null, forcedAfterSuccess: true })).toBe(false);
  });
});
