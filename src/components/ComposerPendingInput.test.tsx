import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import ComposerWindow from './ComposerWindow';
import StandaloneComposerApp from './StandaloneComposerApp';
import useComposerController from '../hooks/useComposerController';
import useAppShortcuts from '../hooks/useAppShortcuts';
import { emptyDraft } from '../app/appConfig';
import type { Account, OutboundAttachmentInput } from '../app/types';

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  close: vi.fn(async () => undefined),
  nativeClose: null as null | ((event: { preventDefault: () => void }) => void),
}));
vi.mock('../tauriBridge', () => ({
  invoke: bridge.invoke,
  getCurrentWindow: () => ({ onDragDropEvent: async () => () => undefined }),
  onCurrentWindowCloseRequested: async (callback: typeof bridge.nativeClose) => {
    bridge.nativeClose = callback;
    return () => { bridge.nativeClose = null; };
  },
  closeCurrentWindow: bridge.close,
  showCurrentWindow: async () => undefined,
  startDraggingCurrentWindow: async () => undefined,
  emitToMain: async () => undefined,
  listenCurrentWindow: async () => () => undefined,
  takePendingComposerRequest: async () => null,
  localFileAssetUrl: async () => '',
  COMPOSER_CLOSED_EVENT: 'composer-closed',
  COMPOSER_CONTACTS_SETTINGS_EVENT: 'composer-contacts',
  COMPOSER_OPEN_EVENT: 'composer-open',
  COMPOSER_READY_EVENT: 'composer-ready',
  COMPOSER_READY_QUERY_EVENT: 'composer-ready-query',
}));

type Controller = ReturnType<typeof useComposerController>;
const noop = () => undefined;
const done = async () => undefined;
const accounts = [
  { id: 1, email: 'one@example.com', display_name: '工作邮箱', signature: '', cross_account_risk_warning: true },
  { id: 2, email: 'two@example.com', display_name: '私人邮箱', signature: '', cross_account_risk_warning: true },
] as Account[];

function Harness({ controllerRef, direct = false }: { controllerRef: MutableRefObject<Controller | null>; direct?: boolean }) {
  const controller = useComposerController({
    account: accounts[0], accounts, identities: [], selectedId: null,
    pendingSendUndo: null, sendUndoDelaySeconds: direct ? 0 : 5,
    setOutbox: noop, setPendingSendUndo: noop, setSelectedId: noop, setStatus: noop,
    showToast: noop, loadMeta: async () => ({ folderId: null, folders: [] }),
    refreshAll: done, focusMailboxRole: done,
  });
  controllerRef.current = controller;
  useAppShortcuts({
    searchInputRef: { current: null }, messages: [], selected: null, selectedId: null,
    selectedMessages: [], selectedMessageIds: [], listMode: 'messages', undoAction: null,
    isComposerOpen: controller.isComposerOpen, isComposerMinimized: controller.isComposerMinimized,
    isComposerModal: false, isSettingsOpen: false, isShortcutsOpen: false, isAccountLoginRequired: false,
    closeOverlays: controller.closeComposer, clearSelection: noop, setStatus: noop,
    restoreUndoAction: done, toggleAllVisibleMessages: noop, openShortcuts: noop,
    composeNew: noop, setSelectedId: noop, runBulkAction: done,
    composeFromMessage: noop, toggleStar: done, toggleRead: done, moveSelected: done,
  });
  return controller.isComposerOpen ? <ComposerWindow
    editorFlushRef={controller.editorFlushRef}
    submissionPending={controller.isSubmitting}
    minimized={controller.isComposerMinimized}
    draft={controller.draft} accounts={accounts} identities={[]} fallbackAccountId={1}
    contacts={[]} onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
    templates={[]} templateName="" richComposer dropActive={false} status="" autosave={null}
    onMinimize={() => controller.setComposerMinimized(true)}
    onRestore={() => controller.setComposerMinimized(false)}
    onClose={controller.closeComposer} onDraftChange={controller.setDraft}
    onApplyTemplate={noop} onDeleteTemplate={noop} onTemplateNameChange={noop}
    onSaveTemplate={noop} onInsertSignature={noop} onPickAttachments={noop}
    onRemoveAttachment={noop} onAttachmentDrop={noop} onAttachmentDragEnter={noop}
    onAttachmentDragLeave={noop} onAttachmentDragOver={noop} onAttachmentPaste={noop}
    buildInlineImageAttachments={async () => []} onInlineImagesAdded={noop}
    onSaveDraft={controller.saveDraft} onQueueDraft={() => { void controller.queueDraft(); }}
    onSendDraft={() => { void controller.requestSend(); }}
    onSendRiskConfirm={noop} onSendRiskCancel={noop}
    sendRiskConfirm={null} crossAccountRisks={[]}
    sendProgress={null} sendProgressMessage={null} attachmentProgress={null}
  /> : null;
}

let frames: FrameRequestCallback[];
beforeEach(() => {
  localStorage.clear();
  frames = [];
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: noop, removeEventListener: noop })));
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  bridge.close.mockClear();
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'load_composer_recovery') return { revision: 0, payload: null };
    if (command === 'get_platform') return 'web';
    if (command === 'list_accounts' || command === 'list_contacts' || command === 'list_identities') return [];
    if (command === 'get_account') return null;
    if (command === 'save_draft') return { draft_id: 7, message: '已保存草稿' };
    if (command === 'queue_outbox_message') return { id: 7, message_id: 7 };
    if (command === 'enqueue_background_task') return { id: 7, progress: 0, message: '准备发送' };
    if (command === 'send_message') return 7;
    return true;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function typeWithoutFrame(text: string) {
  const editor = screen.getByRole('textbox', { name: '邮件正文（富文本）' });
  editor.focus();
  editor.innerHTML = text;
  fireEvent.input(editor);
  return editor;
}

describe('pending rich input at business action boundaries', () => {
  it('keeps the actual controller save menu open while a picker is pending, then saves the complete draft', async () => {
    let finishImport!: (files: OutboundAttachmentInput[]) => void;
    const picked = new Promise<OutboundAttachmentInput[]>((resolve) => { finishImport = resolve; });
    const defaultInvoke = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command: string) => command === 'pick_outbound_attachments' ? picked : defaultInvoke(command));
    const controllerRef: MutableRefObject<Controller | null> = { current: null };
    render(<Harness controllerRef={controllerRef} />);
    act(() => controllerRef.current!.openComposer({ ...emptyDraft, account_id: 1, body: '保留完整草稿' }));
    let importing!: Promise<void>;
    await act(async () => { importing = controllerRef.current!.pickDraftAttachments(); });
    // The minimal harness deliberately omits the derived disabled state, as
    // happens when an action races the import notification's React commit.
    fireEvent.click(screen.getByRole('button', { name: '更多写信工具' }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '保存并关闭' })); });
    expect(screen.getByRole('menu', { name: '更多写信工具' })).not.toBeNull();
    expect(screen.getByText('附件仍在准备中，请等待完成后再发送或保存草稿。')).not.toBeNull();
    expect(bridge.invoke.mock.calls.some(([command]) => command === 'save_draft')).toBe(false);
    expect(controllerRef.current!.draft.body).toBe('保留完整草稿');

    const attachment = { filename: '资料.txt', mime_type: 'text/plain', size_bytes: 4, local_path: '/tmp/mock/资料.txt' };
    await act(async () => { finishImport([attachment]); await importing; });
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '保存并关闭' })); });
    expect(bridge.invoke).toHaveBeenCalledWith('save_draft', expect.objectContaining({ input: expect.objectContaining({
      body: '保留完整草稿', attachments: [attachment],
    }) }));
    expect(controllerRef.current!.isComposerOpen).toBe(false);
    expect(controllerRef.current!.draft).toEqual(emptyDraft);
  });

  it.each(['minimize', 'close', 'shortcut-close', 'save', 'queue', 'send', 'direct-send'] as const)(
    'commits the final input before %s without waiting for blur, a frame, or a React render', async (action) => {
      const controllerRef: MutableRefObject<Controller | null> = { current: null };
      render(<Harness controllerRef={controllerRef} direct={action === 'direct-send'} />);
      act(() => controllerRef.current!.openComposer({
        ...emptyDraft, account_id: 1,
        to: ['queue', 'send', 'direct-send'].includes(action) ? 'recipient@example.com' : '',
      }));
      const actions = controllerRef.current!;
      const text = '输入的最后一个字也必须保留';
      await act(async () => {
        typeWithoutFrame(text);
        expect(actions.draft.body).toBe('');
        // Use the callback captured before input. A setState-only flush would
        // still expose the old closure here in React's same-event batching.
        if (action === 'minimize') actions.setComposerMinimized(true);
        else if (action === 'close') expect(actions.closeComposer()).toBe(false);
        else if (action === 'shortcut-close') fireEvent.keyDown(window, { key: 'Escape' });
        else if (action === 'save') await actions.saveDraft();
        else if (action === 'queue') await actions.queueDraft();
        else await actions.requestSend();
      });
      expect(cancelAnimationFrame).toHaveBeenCalled();
      if (['minimize', 'close', 'shortcut-close'].includes(action)) {
        expect(controllerRef.current!.draft.body).toBe(text);
        expect(controllerRef.current!.isComposerOpen).toBe(true);
        if (action === 'minimize') {
          act(() => controllerRef.current!.setComposerMinimized(false));
          expect(screen.getByRole('textbox', { name: '邮件正文（富文本）' }).textContent).toBe(text);
        } else expect(controllerRef.current!.composerCloseConfirmOpen).toBe(true);
      } else {
        const command = action === 'save' ? 'save_draft' : action === 'direct-send' ? 'send_message' : 'queue_outbox_message';
        expect(bridge.invoke).toHaveBeenCalledWith(command, expect.objectContaining({
          input: expect.objectContaining({ body: text, html_body: text }),
        }));
        expect(controllerRef.current!.draft).toEqual(emptyDraft);
        expect(controllerRef.current!.isComposerOpen).toBe(false);
        expect(controllerRef.current!.editorFlushRef.current).toBeNull();
        // Even if a previously queued callback is delivered after cancellation,
        // it cannot resurrect the submitted body or replace the next draft.
        act(() => controllerRef.current!.openComposer({ ...emptyDraft, body: '下一封邮件' }));
        act(() => frames.forEach((callback) => callback(100)));
        expect(controllerRef.current!.draft.body).toBe('下一封邮件');
      }
    },
  );

  it('checks cross-account send risks using recipient changes from the same event', async () => {
    const controllerRef: MutableRefObject<Controller | null> = { current: null };
    render(<Harness controllerRef={controllerRef} />);
    act(() => controllerRef.current!.openComposer({ ...emptyDraft, account_id: 1, to: 'recipient@example.com' }));
    const actions = controllerRef.current!;
    await act(async () => {
      typeWithoutFrame('最新正文');
      actions.setDraft((current) => ({ ...current, to: 'two@example.com' }));
      await actions.requestSend();
    });
    expect(controllerRef.current!.sendRiskConfirm?.[0].id).toBe('self-recipient-other-account');
    expect(controllerRef.current!.draft.body).toBe('最新正文');
    expect(bridge.invoke.mock.calls.some(([command]) => command === 'queue_outbox_message')).toBe(false);
  });

  it('flushes native close requests before deciding whether the standalone draft is empty', async () => {
    await act(async () => { render(<StandaloneComposerApp />); });
    expect(bridge.nativeClose).not.toBeNull();
    const preventDefault = vi.fn();
    act(() => {
      typeWithoutFrame('原生关闭前的最后输入');
      bridge.nativeClose!({ preventDefault });
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(bridge.close).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '保存这封邮件？' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存并关闭' })));
    expect(bridge.invoke).toHaveBeenCalledWith('save_draft', expect.objectContaining({
      input: expect.objectContaining({ body: '原生关闭前的最后输入' }),
    }));
    expect(bridge.close).toHaveBeenCalledOnce();
  });

  it('still closes a truly empty native composer exactly once', async () => {
    await act(async () => { render(<StandaloneComposerApp />); });
    await act(async () => { bridge.nativeClose!({ preventDefault: noop }); });
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: '保存这封邮件？' })).toBeNull();
  });
});
