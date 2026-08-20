import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  it('restores focus after the background is no longer inert', async () => {
    const shell = (open: boolean) => (
      <div data-testid="composer-shell">
        <button type="button">写邮件入口</button>
        {open ? composer() : null}
      </div>
    );
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
  });
});
