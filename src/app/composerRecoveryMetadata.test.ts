import { describe, expect, it } from 'vitest';
import { emptyDraft, parseComposerAutosave } from './composerConfig';
import { pendingAttachmentRecovery, type AttachmentImportItem } from './attachmentImports';

describe('unfinished attachment recovery metadata', () => {
  it('keeps an otherwise empty checkpoint with unfinished files and strips non-metadata fields', () => {
    const parsed = parseComposerAutosave({
      draft: emptyDraft,
      pending_attachments: [{ filename: '/private/source/report.pdf', size_bytes: 12, is_inline: false,
        local_path: '/private/source/report.pdf', file: { data: 'secret' }, error: 'sensitive path' }],
    });
    expect(parsed?.pending_attachments).toEqual([{ filename: 'report.pdf', size_bytes: 12, is_inline: false }]);
    expect(parsed?.draft).not.toHaveProperty('pending_attachments');
    expect(parseComposerAutosave({ draft: emptyDraft, pending_attachments: [] })).toBeNull();
  });

  it('keeps read inline files unresolved until their CID is committed to the draft', () => {
    const image: AttachmentImportItem = {
      id: 'a', filename: 'image.png', sizeBytes: 10, status: 'ready', progress: 100,
      error: null, source: 'file', inline: true, contentId: 'a@inline',
    };
    expect(pendingAttachmentRecovery([image], [])).toEqual([{ filename: 'image.png', size_bytes: 10, is_inline: true }]);
    expect(pendingAttachmentRecovery([image], [{ filename: 'image.png', size_bytes: 10, mime_type: 'image/png', local_path: '/temp/image', content_id: 'a@inline', is_inline: true }])).toEqual([]);
  });
});


it('preserves a validated inline reply source through recovery and ignores malformed provenance', () => {
  const source = { key: '2:18', revision: 'version-1', body: '原始快速回复', mode: 'reply' as const };
  const draft = { ...emptyDraft, body: '完整窗口继续编辑', quick_reply_source: source };
  expect(parseComposerAutosave({ draft })?.draft.quick_reply_source).toEqual(source);
  expect(parseComposerAutosave({ draft: { ...draft, quick_reply_source: { ...source, key: 'invalid' } } })?.draft.quick_reply_source).toBeUndefined();
});
