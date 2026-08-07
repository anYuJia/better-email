import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DraftInput } from '../../app/types';
import ComposerQuickTools from './ComposerQuickTools';

const draft: DraftInput = {
  draft_id: 0,
  account_id: 1,
  identity_id: 0,
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  html_body: '<p>正文</p>',
  send_at: '',
  attachments: [],
};

describe('ComposerQuickTools', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps rich-text source internal instead of rendering an HTML source box', () => {
    const { container } = render(
      <ComposerQuickTools
        draft={draft}
        richComposer
        dropActive={false}
        signature=""
        onPatchDraft={vi.fn()}
        onRichComposerChange={vi.fn()}
        onInsertSignature={vi.fn()}
        onPickAttachments={vi.fn()}
        onAttachmentDrop={vi.fn()}
        onAttachmentDragEnter={vi.fn()}
        onAttachmentDragLeave={vi.fn()}
        onAttachmentDragOver={vi.fn()}
      />,
    );

    expect(screen.getByText('富文本')).not.toBeNull();
    expect(container.querySelector('.composer-html-source')).toBeNull();
    expect(screen.queryByPlaceholderText('HTML 正文，将在保存和发送前清洗')).toBeNull();
  });
});
