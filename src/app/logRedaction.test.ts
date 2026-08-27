import { describe, expect, it } from 'vitest';
import { redactLogValue, redactSensitiveText } from './logRedaction';

describe('log redaction', () => {
  it('redacts email addresses, bearer tokens and inline secrets', () => {
    const output = redactSensitiveText(
      'account=user@example.com Authorization: Bearer abc.def token=super-secret',
    );
    expect(output).not.toContain('user@example.com');
    expect(output).not.toContain('abc.def');
    expect(output).not.toContain('super-secret');
    expect(output).toContain('[email]');
    expect(output).toContain('[redacted]');
  });

  it('redacts nested sensitive fields without mutating useful diagnostics', () => {
    const output = redactLogValue({
      account: 'user@example.com',
      status: 'failed',
      credentials: {
        api_key: 'sk-secret',
        refresh_token: 'refresh-secret',
      },
    }) as Record<string, unknown>;
    expect(output.account).toBe('[email]');
    expect(output.status).toBe('failed');
    expect(output.credentials).toEqual({
      api_key: '[redacted]',
      refresh_token: '[redacted]',
    });
  });

  it('handles errors and circular objects safely', () => {
    const value: Record<string, unknown> = { error: new Error('mail user@example.com token=abc') };
    value.self = value;
    const output = redactLogValue(value) as Record<string, unknown>;
    expect(output.self).toBe('[circular]');
    expect(JSON.stringify(output.error)).not.toContain('user@example.com');
    expect(JSON.stringify(output.error)).not.toContain('token=abc');
  });
});
