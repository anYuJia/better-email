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
        dropActive={false}
        signature=""
        onInsertSignature={vi.fn()}
        onPickAttachments={vi.fn()}
        onAttachmentDrop={vi.fn()}
        onAttachmentDragEnter={vi.fn()}
        onAttachmentDragLeave={vi.fn()}
        onAttachmentDragOver={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('富文本')).toBeNull();
    expect(screen.getByRole('button', { name: '加粗' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '斜体' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '清除格式' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '插入链接' })).toBeNull();
    expect(screen.getByRole('button', { name: '无序列表' })).not.toBeNull();
    expect(container.querySelector('.composer-html-source')).toBeNull();
    expect(screen.queryByPlaceholderText('HTML 正文，将在保存和发送前清洗')).toBeNull();
  });
});
