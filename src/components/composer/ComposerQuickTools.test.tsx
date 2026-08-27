import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DraftInput } from '../../app/types';
import ComposerQuickTools, { ComposerRichToolbar } from './ComposerQuickTools';

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

  it('keeps inline-format buttons selected from the saved editor range after focus leaves the editor', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.innerHTML = '<strong><em><u><mark>重点内容</mark></u></em></strong>';
    document.body.append(editor);

    const text = editor.querySelector('mark')?.firstChild;
    if (!text) throw new Error('formatted text node missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    render(<ComposerRichToolbar editorRef={{ current: editor }} />);

    expect(screen.getByRole('button', { name: '加粗' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '斜体' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '下划线' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '文字高亮' }).getAttribute('aria-pressed')).toBe('true');

    editor.remove();
  });

  it('lets users choose all four inline formats before typing into an empty editor', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.dataset.empty = 'true';
    document.body.append(editor);

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    render(<ComposerRichToolbar editorRef={{ current: editor }} />);

    ['加粗', '斜体', '下划线', '文字高亮'].forEach((label) => {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
    });

    const typingMarker = editor.querySelector<HTMLElement>('[data-composer-typing-format]');
    expect(typingMarker).not.toBeNull();
    expect(typingMarker?.style.fontWeight).toBe('700');
    expect(typingMarker?.style.fontStyle).toBe('italic');
    expect(typingMarker?.style.textDecorationLine).toBe('underline');
    expect(typingMarker?.style.backgroundColor).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(screen.getByRole('button', { name: '加粗' }).getAttribute('aria-pressed')).toBe('false');
    expect(typingMarker?.style.fontWeight).toBe('');

    editor.remove();
  });

  it('does not trust transient native command success for collapsed inline formatting', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.append(editor);
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const queryCommandStateDescriptor = Object.getOwnPropertyDescriptor(document, 'queryCommandState');
    let transientCommand = '';
    const execCommand = vi.fn((command: string) => {
      transientCommand = command;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    Object.defineProperty(document, 'queryCommandState', {
      configurable: true,
      value: vi.fn((command: string) => command === transientCommand),
    });

    try {
      render(<ComposerRichToolbar editorRef={{ current: editor }} />);

      ['加粗', '斜体', '下划线'].forEach((label) => {
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
      });

      const typingMarker = editor.querySelector<HTMLElement>('[data-composer-typing-format]');
      expect(execCommand).not.toHaveBeenCalled();
      expect(typingMarker?.style.fontWeight).toBe('700');
      expect(typingMarker?.style.fontStyle).toBe('italic');
      expect(typingMarker?.style.textDecorationLine).toBe('underline');
    } finally {
      if (execCommandDescriptor) {
        Object.defineProperty(document, 'execCommand', execCommandDescriptor);
      } else {
        Reflect.deleteProperty(document, 'execCommand');
      }
      if (queryCommandStateDescriptor) {
        Object.defineProperty(document, 'queryCommandState', queryCommandStateDescriptor);
      } else {
        Reflect.deleteProperty(document, 'queryCommandState');
      }
      editor.remove();
    }
  });

  it('applies and removes inline formats on selected text when native edit commands are unavailable', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = '选中的正文';
    document.body.append(editor);

    const text = editor.firstChild;
    if (!(text instanceof Text)) throw new Error('editor text missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    render(<ComposerRichToolbar editorRef={{ current: editor }} />);

    ['加粗', '斜体', '下划线', '文字高亮'].forEach((label) => {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
    });
    expect(editor.querySelector('strong')).not.toBeNull();
    expect(editor.querySelector('em')).not.toBeNull();
    expect(editor.querySelector('u')).not.toBeNull();
    expect(editor.querySelector('mark')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '文字高亮' }));
    expect(screen.getByRole('button', { name: '文字高亮' }).getAttribute('aria-pressed')).toBe('false');
    expect(editor.querySelector('mark')).toBeNull();

    editor.remove();
  });
});
