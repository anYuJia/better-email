import { describe, expect, it } from 'vitest';
import {
  canonicalRecipientEmails,
  parseRecipientInput,
  recipientErrorMessage,
  uniqueRecipientEmails,
} from './recipientAddresses';

describe('recipientAddresses', () => {
  it('parses mixed separators and display names', () => {
    const result = parseRecipientInput('Ada <ADA@example.com>， grace@example.com;\nlin@example.com\t');
    expect(result.valid.map((token) => token.email)).toEqual([
      'ADA@example.com',
      'grace@example.com',
      'lin@example.com',
    ]);
    expect(result.invalid).toHaveLength(0);
  });

  it('deduplicates case-insensitively and reports invalid tokens', () => {
    const result = parseRecipientInput('ada@example.com, ADA@example.com, broken-address');
    expect(result.valid.map((token) => token.normalized)).toEqual(['ada@example.com']);
    expect(result.duplicates).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(recipientErrorMessage(result.invalid.length, result.duplicates.length)).toBe('1 个地址格式不正确，已跳过；1 个重复地址已跳过');
  });

  it('removes addresses already used by another recipient field', () => {
    const blocked = canonicalRecipientEmails('to@example.com', 'cc@example.com');
    expect(uniqueRecipientEmails(['CC@example.com', 'bcc@example.com'], blocked)).toEqual(['bcc@example.com']);
  });
});
