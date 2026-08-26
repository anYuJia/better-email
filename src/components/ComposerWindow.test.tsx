import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cloneElement } from 'react';
import { emptyDraft } from '../app/composerConfig';
import ComposerWindow from './ComposerWindow';

afterEach(cleanup);

function composer() {
  return (
    <ComposerWindow
      minimized={false}
      draft={emptyDraft}
      accounts={[]}
      identities={[]}
      fallbackAccountId={0}
      contacts={[]}
      onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
      templates={[]}
      templateName=""
      richComposer={false}
      dropActive={false}
      status=""
      autosave={null}
      onMinimize={vi.fn()}
      onRestore={vi.fn()}
      onClose={vi.fn()}
      onDraftChange={vi.fn()}
      onApplyTemplate={vi.fn()}
      onDeleteTemplate={vi.fn()}
      onTemplateNameChange={vi.fn()}
      onSaveTemplate={vi.fn()}
      onInsertSignature={vi.fn()}
      onPickAttachments={vi.fn()}
      onRemoveAttachment={vi.fn()}
      onAttachmentDrop={vi.fn()}
      onAttachmentDragEnter={vi.fn()}
      onAttachmentDragLeave={vi.fn()}
      onAttachmentDragOver={vi.fn()}
      onAttachmentPaste={vi.fn()}
      buildInlineImageAttachments={vi.fn(async () => [])}
      onInlineImagesAdded={vi.fn()}
      onSaveDraft={vi.fn()}
      onQueueDraft={vi.fn()}
      onSendDraft={vi.fn()}
      onSendRiskConfirm={vi.fn()}
      onSendRiskCancel={vi.fn()}
      sendRiskConfirm={null}
      crossAccountRisks={[]}
      sendProgress={null}
      sendProgressMessage={null}
      attachmentProgress={null}
    />
  );
}

describe('ComposerWindow focus lifecycle', () => {
  it('keeps the contact picker reachable on a phone-sized viewport', () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      render(composer());

      expect(screen.queryByRole('complementary', { name: '联系人' })).toBeNull();
      const contactToggle = screen.getByRole('button', { name: '切换联系人面板' });
      expect(contactToggle.getAttribute('aria-controls')).toBe('composer-contacts-panel');
      expect(contactToggle.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(contactToggle);
      expect(screen.getByRole('complementary', { name: '联系人' })).not.toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });

  it('keeps the sending account and identity visible outside advanced options', () => {
    render(composer());

    const sender = screen.getByRole('combobox', { name: '发件人' });

    expect(sender.closest('.composer-sender-context')).not.toBeNull();
    expect(sender.closest('details')).toBeNull();
    expect(screen.getByRole('dialog').querySelector('.composer-advanced')).toBeNull();
  });

  it('restores focus after the background is no longer inert', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const shell = (open: boolean) => (
      <div data-testid="composer-shell">
        <button type="button">写邮件入口</button>
        {open ? composer() : null}
      </div>
    );
    try {
      const { rerender } = render(shell(false));
      const opener = screen.getByRole('button', { name: '写邮件入口' });
      opener.focus();

      rerender(shell(true));
      expect(opener.closest('[inert]')).not.toBeNull();
      expect(document.activeElement).not.toBe(opener);

      rerender(shell(false));
      await waitFor(() => {
        expect(opener.closest('[inert]')).toBeNull();
        expect(document.activeElement).toBe(opener);
      });
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });

  it('shows the local autosave state in the composer header', () => {
    const draft = { ...emptyDraft, subject: '待处理邮件' };
    render(cloneElement(composer(), {
      draft,
      autosave: {
        draft,
        isRichComposer: false,
        saved_at: '2026-08-23T13:17:00.000Z',
      },
    }));

    expect(screen.getByText(/已自动保存/)).not.toBeNull();
    expect(screen.queryByText(/已备份恢复点/)).toBeNull();
  });

  it('keeps a never-edited empty draft header focused on the window title', () => {
    render(composer());

    expect(screen.getByText('新邮件')).not.toBeNull();
    expect(screen.queryByText('未输入内容')).toBeNull();
  });

  it('keeps one window action set while the desktop contacts rail stays fixed', () => {
    render(composer());

    const dialog = screen.getByRole('dialog', { name: '写信窗口' });
    const contactsPanel = screen.getByRole('complementary', { name: '联系人' });
    expect(dialog.classList.contains('is-floating')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(contactsPanel.querySelector('[aria-label="收起写信"]')).toBeNull();
    expect(contactsPanel.querySelector('[aria-label="关闭写信窗口"]')).toBeNull();
    expect(contactsPanel.querySelector('[aria-label="关闭联系人面板"]')).toBeNull();
    expect(screen.queryByRole('button', { name: '切换联系人面板' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '收起写信' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '关闭写信窗口' })).toHaveLength(1);
  });

  it('keeps immediate send, scheduled send, and outbox actions semantically distinct', () => {
    const onSendDraft = vi.fn();
    const onQueueDraft = vi.fn();
    const { rerender } = render(cloneElement(composer(), { onSendDraft, onQueueDraft }));

    expect(screen.queryByRole('status', { name: /定时/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onSendDraft).toHaveBeenCalledTimes(1);
    expect(onQueueDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '发送选项' }));
    expect(screen.getByRole('menuitem', { name: '发件箱' })).not.toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: '发件箱' }));
    expect(onQueueDraft).toHaveBeenCalledTimes(1);

    const scheduledDraft = { ...emptyDraft, send_at: '2026-08-28T09:00' };
    rerender(cloneElement(composer(), { draft: scheduledDraft, onSendDraft, onQueueDraft }));
    const scheduledButton = screen.getByRole('button', { name: /定时发送 ·/ });
    fireEvent.click(scheduledButton);
    expect(onQueueDraft).toHaveBeenCalledTimes(2);
    expect(onSendDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/将于 8月28日 09:00 发送/)).not.toBeNull();
  });

  it('opens the schedule picker from the send menu without reserving a status block', () => {
    render(composer());

    fireEvent.click(screen.getByRole('button', { name: '发送选项' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '定时发送…' }));

    expect(screen.getByRole('dialog', { name: '选择定时发送时间' })).not.toBeNull();
    expect(document.querySelector('.composer-schedule-status')).toBeNull();
  });
});
