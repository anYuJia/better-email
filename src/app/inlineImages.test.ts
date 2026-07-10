import { describe, expect, it } from 'vitest';
import {
  normalizeContentId,
  resolveCidInlineImages,
} from './inlineImages';
import type { Attachment } from './types';

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 1,
    message_id: 10,
    filename: 'logo.png',
    mime_type: 'image/png',
    size_bytes: 2048,
    is_downloaded: true,
    local_path: '/tmp/logo.png',
    content_id: 'logo@example.com',
    is_inline: true,
    ...overrides,
  };
}

describe('CID inline images', () => {
  it('normalizes CID prefixes, angle brackets, casing, and encoded values', () => {
    expect(normalizeContentId('cid:<Logo@Example.COM>')).toBe('logo@example.com');
    expect(normalizeContentId('CID:%3CLogo%40Example.COM%3E')).toBe('logo@example.com');
  });

  it('replaces only downloaded inline image references with asset URLs', () => {
    const result = resolveCidInlineImages(
      '<p>Hello</p><img src="cid:<Logo@Example.COM>"><img src="https://example.com/remote.png">',
      [attachment()],
      (path) => `asset://localhost/${path}`,
    );

    expect(result.html).toContain('src="asset://localhost//tmp/logo.png"');
    expect(result.html).toContain('src="https://example.com/remote.png"');
    expect(result.resolvedContentIds).toEqual(['logo@example.com']);
    expect(result.pendingAttachments).toEqual([]);
    expect(result.missingContentIds).toEqual([]);
  });

  it('returns pending downloads and hides unresolved CID sources', () => {
    const pending = attachment({ is_downloaded: false, local_path: '' });
    const result = resolveCidInlineImages(
      '<img src="cid:logo@example.com">',
      [pending],
      () => '',
    );

    expect(result.html).not.toContain('src="cid:');
    expect(result.html).toContain('data-better-email-inline-cid="logo@example.com"');
    expect(result.pendingAttachments).toEqual([pending]);
    expect(result.missingContentIds).toEqual([]);
  });

  it('ignores regular files and reports missing CID references', () => {
    const result = resolveCidInlineImages(
      '<img src="cid:missing@example.com">',
      [attachment({ is_inline: false })],
      () => 'asset://unused',
    );

    expect(result.pendingAttachments).toEqual([]);
    expect(result.missingContentIds).toEqual(['missing@example.com']);
  });
});
