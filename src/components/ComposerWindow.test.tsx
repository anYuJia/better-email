import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cloneElement, StrictMode, useRef, useState, type SetStateAction } from 'react';
import { emptyDraft } from '../app/composerConfig';
import type { Account, Contact, DraftInput } from '../app/types';
import ComposerWindow from './ComposerWindow';
import useExitPresence from '../hooks/useExitPresence';
import * as contactSuggestions from './composer/contactSuggestions';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('ComposerWindow surface motion lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function enableMotion() {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
  }

  it.each(['minimize', 'close'])('flushes the last rich edit before immediate %s while its animation frame is pending', (action) => {
    enableMotion();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const patch = vi.fn();
    const closedDraft = vi.fn();
    function PendingEditHarness() {
      const [draft, setDraft] = useState(emptyDraft);
      const draftRef = useRef(draft);
      const [open, setOpen] = useState(true);
      const [minimized, setMinimized] = useState(false);
      return <>
        <output data-testid="saved-rich-body">{draft.body}</output>
        {cloneElement(composer(), {
          draft, open, minimized, richComposer: true,
          onDraftChange: (value: SetStateAction<DraftInput>) => {
            const next: DraftInput = typeof value === 'function' ? value(draftRef.current) : value;
            draftRef.current = next;
            patch(next);
            setDraft(next);
          },
          onMinimize: () => setMinimized(true),
          onRestore: () => setMinimized(false),
          onClose: () => { closedDraft(draftRef.current); setOpen(false); },
        })}
      </>;
    }
    render(<PendingEditHarness />);
    const editor = screen.getByRole('textbox', { name: '邮件正文（富文本）' });
    editor.focus();
    editor.innerHTML = '尚未进入下一帧的文字';
    fireEvent.input(editor);
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: action === 'minimize' ? '收起写信' : '关闭写信窗口' }));
    expect(screen.getByTestId('saved-rich-body').textContent).toBe('尚未进入下一帧的文字');
    expect(cancelAnimationFrame).toHaveBeenCalled();
    if (action === 'close') expect(closedDraft.mock.calls[0][0].body).toBe('尚未进入下一帧的文字');
    else {
      act(() => vi.advanceTimersByTime(240));
      fireEvent.click(screen.getByRole('button', { name: '展开写信窗口' }));
      expect(screen.getByRole('textbox', { name: '邮件正文（富文本）' }).textContent).toBe('尚未进入下一帧的文字');
    }
  });

  it('minimizes immediately but retains the outgoing editor and cancels removal on restore', () => {
    enableMotion();
    const onMinimize = vi.fn();
    const onDraftChange = vi.fn();
    const view = cloneElement(composer(), { onMinimize, onDraftChange });
    const { container, rerender } = render(view);
    const body = screen.getByRole('textbox', { name: '邮件正文' });
    fireEvent.click(screen.getByRole('button', { name: '收起写信' }));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    rerender(cloneElement(view, { minimized: true }));
    expect(body.isConnected).toBe(true);
    expect(body.closest('.composer')?.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('.composer-backdrop')?.classList.contains('is-exiting')).toBe(true);
    expect(screen.getByRole('button', { name: '展开写信窗口' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(80));
    rerender(cloneElement(view, { minimized: false }));
    expect(screen.getByRole('textbox', { name: '邮件正文' })).toBe(body);
    fireEvent.change(body, { target: { value: '立即输入' } });
    expect(onDraftChange).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(180));
    expect(body.isConnected).toBe(true);
    expect(container.querySelector('.composer-backdrop')?.classList.contains('is-exiting')).toBe(false);
  });

  it('dispatches close immediately and removes the inert outgoing surface after exit', () => {
    enableMotion();
    const onClose = vi.fn();
    const onDraftChange = vi.fn();
    const view = cloneElement(composer(), { onClose, onDraftChange, draft: { ...emptyDraft, body: '退出时保留的草稿正文' } });
    const { container, rerender } = render(view);
    fireEvent.click(screen.getByRole('button', { name: '关闭写信窗口' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(cloneElement(view, { open: false, draft: emptyDraft }));
    expect(container.querySelector('.composer-backdrop')?.classList.contains('is-exiting')).toBe(true);
    expect(container.querySelector('.composer')?.hasAttribute('inert')).toBe(true);
    const outgoingBody = container.querySelector('textarea[aria-label="邮件正文"]') as HTMLTextAreaElement;
    expect(outgoingBody.value).toBe('退出时保留的草稿正文');
    fireEvent.change(outgoingBody, { target: { value: '过时输入' } });
    expect(onDraftChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(180));
    expect(container.querySelector('.composer-backdrop')).toBeNull();
  });

  it('hides the retained editor immediately for reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const { container, rerender } = render(composer());
    rerender(cloneElement(composer(), { minimized: true }));
    expect((container.querySelector('.composer-backdrop') as HTMLElement).hidden).toBe(true);
    expect(container.querySelector('.composer-backdrop')?.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('button', { name: '展开写信窗口' })).toBeTruthy();
  });

  it.each([false, true])('preserves rich editing DOM, selection and scroll after a completed minimize (mobile=%s)', (mobile) => {
    enableMotion();
    const view = cloneElement(composer(), {
      mobile, richComposer: true,
      draft: { ...emptyDraft, body: '继续编辑这封邮件', html_body: '<p>继续编辑这封邮件</p>' },
    });
    const { container, rerender } = render(view);
    const editor = screen.getByRole('textbox', { name: '邮件正文（富文本）' });
    const text = editor.querySelector('p')!.firstChild!;
    const fields = container.querySelector('.composer-primary-fields') as HTMLElement;
    const selection = document.getSelection()!;
    editor.focus();
    selection.setBaseAndExtent(text, 6, text, 2);
    editor.scrollTop = 82;
    fields.scrollTop = 140;
    const minimize = screen.getByRole('button', { name: '收起写信' });
    minimize.focus();
    fireEvent.click(minimize);
    rerender(cloneElement(view, { minimized: true }));
    act(() => vi.advanceTimersByTime(240));
    expect(editor.isConnected).toBe(true);
    expect(editor.closest('.composer-backdrop')?.hasAttribute('hidden')).toBe(true);
    expect(editor.closest('[inert]')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: '邮件正文（富文本）' })).toBeNull();
    selection.removeAllRanges();
    editor.scrollTop = 0;
    fields.scrollTop = 0;
    rerender(cloneElement(view, { minimized: false }));
    expect(screen.getByRole('textbox', { name: '邮件正文（富文本）' })).toBe(editor);
    expect(editor.querySelector('p')!.firstChild).toBe(text);
    expect(document.activeElement).toBe(editor);
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(6);
    expect(selection.focusOffset).toBe(2);
    expect(editor.scrollTop).toBe(82);
    expect(fields.scrollTop).toBe(140);
    rerender(cloneElement(view, { open: false }));
    act(() => vi.advanceTimersByTime(180));
    expect(editor.isConnected).toBe(false);
  });

  it('restores the subject selection instead of moving focus to recipients', () => {
    enableMotion();
    const view = cloneElement(composer(), { draft: { ...emptyDraft, subject: '继续编辑主题' } });
    const { rerender } = render(view);
    const subject = screen.getByRole('textbox', { name: '主题' }) as HTMLInputElement;
    subject.focus();
    subject.setSelectionRange(1, 4, 'backward');
    screen.getByRole('button', { name: '收起写信' }).focus();
    rerender(cloneElement(view, { minimized: true }));
    act(() => vi.advanceTimersByTime(240));
    rerender(cloneElement(view, { minimized: false }));
    expect(document.activeElement).toBe(subject);
    expect(subject.selectionStart).toBe(1);
    expect(subject.selectionEnd).toBe(4);
    expect(subject.selectionDirection).toBe('backward');
  });

  it.each(['more', 'schedule', 'sender', 'font', 'fontSize'].flatMap((portal) => [
    [portal, 'close'], [portal, 'minimize'],
  ]))('deactivates the %s body portal immediately on %s', (portal, action) => {
    enableMotion();
    const view = cloneElement(composer(), {
      accounts: [{ id: 1, email: 'sender@example.invalid', display_name: '发件人', signature: '' } as Account],
      fallbackAccountId: 1,
    });
    const { container, rerender } = render(view);
    let selector: string;
    if (portal === 'more') {
      fireEvent.click(screen.getByRole('button', { name: '更多写信工具' }));
      selector = '.composer-advanced-popover';
    } else if (portal === 'schedule') {
      fireEvent.click(screen.getByRole('button', { name: '发送选项' }));
      fireEvent.click(screen.getByRole('menuitem', { name: '定时发送…' }));
      selector = '.composer-schedule-picker-popover';
    } else if (portal === 'sender') {
      fireEvent.click(screen.getByRole('combobox', { name: '发件人' }));
      selector = '[data-portal-owner="composer-sender"]';
    } else {
      fireEvent.click(screen.getByRole('button', { name: '格式' }));
      fireEvent.click(screen.getByRole('combobox', { name: portal === 'font' ? '字体' : '字号' }));
      selector = '[data-portal-owner="composer-rich-toolbar"]';
    }
    expect(document.querySelector(selector)).not.toBeNull();
    rerender(cloneElement(view, { open: action !== 'close', minimized: action === 'minimize' }));
    expect(container.querySelector('.composer-backdrop')?.classList.contains('is-exiting')).toBe(true);
    const outgoing = document.querySelector(selector);
    if (portal === 'more' || portal === 'schedule') {
      expect(outgoing?.hasAttribute('inert')).toBe(true);
      expect(outgoing?.getAttribute('aria-hidden')).toBe('true');
    } else {
      expect(outgoing).toBeNull();
    }
    expect(fireEvent.keyDown(document, { key: 'Escape' })).toBe(true);
    rerender(view);
    // Restoring the editor must not reactivate an outgoing body portal. Its
    // presentation can finish, but it cannot reclaim keyboard interaction.
    if (outgoing) expect(outgoing.hasAttribute('inert')).toBe(true);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    act(() => vi.advanceTimersByTime(120));
    expect(document.querySelector(selector)).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

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

function ComposerFocusHarness({ mobile = false }: { mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const present = useExitPresence(open);
  return <div>
    <button type="button" onClick={() => { setMinimized(false); setOpen(true); }}>写邮件入口</button>
    <button type="button">其他邮件操作</button>
    {present && cloneElement(composer(), {
      open, minimized, mobile,
      onMinimize: () => setMinimized(true),
      onRestore: () => setMinimized(false),
      onClose: () => setOpen(false),
    })}
  </div>;
}

describe('ComposerWindow StrictMode focus restoration', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function setup(mobile = false) {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    render(<StrictMode><ComposerFocusHarness mobile={mobile} /></StrictMode>);
    const opener = screen.getByRole('button', { name: '写邮件入口' });
    opener.focus();
    fireEvent.click(opener);
    return opener;
  }

  it.each([false, true])('keeps the original opener through minimize/restore/close (mobile=%s)', async (mobile) => {
    const opener = setup(mobile);
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement?.closest('.composer')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '收起写信' }));
    act(() => vi.advanceTimersByTime(180));
    expect(document.activeElement?.closest('.composer-minimized')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开写信窗口' }));
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement?.closest('.composer')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭写信窗口' }));
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(opener);
    await act(async () => { vi.advanceTimersByTime(180); await Promise.resolve(); });
    expect(document.activeElement).toBe(opener);
  });

  it('does not restore again after the user moves focus during the exit tail', async () => {
    const opener = setup();
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: '关闭写信窗口' }));
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(opener);
    const next = screen.getByRole('button', { name: '其他邮件操作' });
    next.focus();
    await act(async () => { vi.advanceTimersByTime(180); await Promise.resolve(); });
    expect(document.activeElement).toBe(next);
  });

  it('does not override an explicit focus move before queued close restoration', async () => {
    setup();
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: '关闭写信窗口' }));
    const next = screen.getByRole('button', { name: '其他邮件操作' });
    next.focus();
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(next);
  });
});

describe('ComposerWindow focus lifecycle', () => {
  it('reuses the contact search index for draft edits and dragging, but refreshes changed contacts or account scope', () => {
    const buildIndex = vi.spyOn(contactSuggestions, 'buildContactSearchEntries');
    vi.stubGlobal('PointerEvent', MouseEvent);
    try {
      const contacts: Contact[] = [{ id: 1, account_id: 1, name: '王晓明', email: 'wang@example.invalid', aliases: [], vip: false, message_count: 3, last_seen_at: '' }];
      const view = cloneElement(composer(), { contacts, draft: { ...emptyDraft, account_id: 1 } });
      const { container, rerender } = render(view);
      expect(buildIndex).toHaveBeenCalledTimes(1);
      const editedDraft = { ...view.props.draft, subject: '输入主题', body: '输入正文' };
      rerender(cloneElement(view, { draft: editedDraft }));
      const header = container.querySelector('.composer-editor-header') as HTMLElement;
      const panel = container.querySelector('.composer') as HTMLElement;
      header.setPointerCapture = vi.fn();
      fireEvent.pointerDown(header, { button: 0, clientX: 20, clientY: 20 });
      fireEvent.pointerMove(panel, { clientX: 40, clientY: 40 });
      fireEvent.pointerUp(panel);
      expect(panel.style.transform).not.toBe('translate(0px, 0px)');
      expect(buildIndex).toHaveBeenCalledTimes(1);
      const updated = [{ ...contacts[0], name: '王晓明（更新）' }];
      rerender(cloneElement(view, { contacts: updated, draft: editedDraft }));
      expect(buildIndex).toHaveBeenCalledTimes(2);
      expect(buildIndex.mock.calls[buildIndex.mock.calls.length - 1]?.[0][0].name).toBe('王晓明（更新）');
      rerender(cloneElement(view, { contacts: updated, draft: { ...editedDraft, account_id: 2 } }));
      expect(buildIndex).toHaveBeenCalledTimes(3);
      expect(buildIndex.mock.calls[buildIndex.mock.calls.length - 1]?.[0]).toEqual([]);
    } finally {
      buildIndex.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('only exposes contacts belonging to the draft sending account', () => {
    const account = (id: number, email: string): Account => ({
      id,
      email,
      display_name: `账号 ${id}`,
      provider: 'custom',
      imap_host: '',
      smtp_host: '',
      incoming_protocol: 'imap',
      auth_type: 'password',
      sync_mode: 'manual',
      remote_images_allowed: false,
      signature: '',
      cross_account_risk_warning: true,
      block_external_mailboxes: false,
      intercept_https_links: false,
      auto_download_attachments: false,
      fetch_history_attachments: false,
      warn_external_senders: false,
      onboarding_completed: true,
      is_default: id === 1,
    });
    const contact = (id: number, accountId: number, name: string, email: string): Contact => ({
      id,
      account_id: accountId,
      name,
      email,
      aliases: [],
      vip: false,
      message_count: 1,
      last_seen_at: '2026-08-30T10:00:00Z',
    });
    const contactsPanel = () => screen.getByRole('dialog', { name: '联系人' });

    const { rerender } = render(cloneElement(composer(), {
      defaultContactsOpen: true,
      accounts: [account(1, 'one@example.com'), account(2, 'two@example.com')],
      draft: { ...emptyDraft, account_id: 1 },
      contacts: [
        contact(11, 1, '账号一联系人', 'one-contact@example.com'),
        contact(22, 2, '账号二联系人', 'two-contact@example.com'),
      ],
    }));

    expect(contactsPanel().textContent).toContain('账号一联系人');
    expect(contactsPanel().textContent).not.toContain('账号二联系人');

    rerender(cloneElement(composer(), {
      defaultContactsOpen: true,
      accounts: [account(1, 'one@example.com'), account(2, 'two@example.com')],
      draft: { ...emptyDraft, account_id: 2 },
      contacts: [
        contact(11, 1, '账号一联系人', 'one-contact@example.com'),
        contact(22, 2, '账号二联系人', 'two-contact@example.com'),
      ],
    }));

    expect(contactsPanel().textContent).not.toContain('账号一联系人');
    expect(contactsPanel().textContent).toContain('账号二联系人');
  });

  it('defaults to collapsed contacts on desktop and allows toggling', () => {
    render(composer());

    expect(screen.queryByRole('dialog', { name: '联系人' })).toBeNull();
    const contactToggle = screen.getByRole('button', { name: '切换联系人面板' });
    expect(contactToggle.getAttribute('aria-controls')).toBe('composer-contacts-panel');
    expect(contactToggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(contactToggle);
    expect(screen.getByRole('dialog', { name: '联系人' })).not.toBeNull();
    expect(contactToggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '返回写信' }));
    expect(screen.queryByRole('dialog', { name: '联系人' })).toBeNull();
  });

  it('keeps the contact picker reachable on a phone-sized viewport', () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      render(composer());

      expect(screen.queryByRole('dialog', { name: '联系人' })).toBeNull();
      const contactToggle = screen.getByRole('button', { name: '切换联系人面板' });
      expect(contactToggle.getAttribute('aria-controls')).toBe('composer-contacts-panel');
      expect(contactToggle.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(contactToggle);
      expect(screen.getByRole('dialog', { name: '联系人' })).not.toBeNull();
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

    expect(screen.getByText('已存本机')).not.toBeNull();
    expect(screen.getByText('已存本机').title).toContain('保存到草稿箱');
    expect(screen.queryByText(/已备份恢复点/)).toBeNull();
  });

  it('shows explicit draft-saving progress instead of a stale autosave timestamp', () => {
    const draft = { ...emptyDraft, subject: '待保存邮件' };
    render(cloneElement(composer(), {
      draft,
      status: '正在保存草稿…',
      autosave: {
        draft,
        isRichComposer: false,
        saved_at: '2026-08-23T13:17:00.000Z',
      },
    }));

    expect(screen.getByText('正在保存草稿…')).not.toBeNull();
    expect(screen.queryByText(/已自动保存/)).toBeNull();
  });

  it('locks the editor and keeps the save menu visible until saving finishes', async () => {
    let finishSave: (() => void) | null = null;
    const onSaveDraft = vi.fn(() => new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    render(cloneElement(composer(), {
      draft: { ...emptyDraft, subject: '需要保存' },
      onSaveDraft,
    }));

    fireEvent.click(screen.getByRole('button', { name: '更多写信工具' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '保存并关闭' }));

    const composerPanel = document.querySelector<HTMLElement>('.composer');
    const savingAction = screen.getByRole('menuitem', { name: '正在保存…' });
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(composerPanel?.getAttribute('aria-busy')).toBe('true');
    expect(composerPanel?.hasAttribute('inert')).toBe(true);
    expect(savingAction.hasAttribute('disabled')).toBe(true);

    await act(async () => {
      finishSave?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: '正在保存…' })).toBeNull();
      expect(composerPanel?.hasAttribute('inert')).toBe(false);
    });
  });

  it('keeps the draft menu open and unlocks editing when saving fails', async () => {
    const onSaveDraft = vi.fn().mockRejectedValue(new Error('暂时无法连接草稿箱'));
    render(cloneElement(composer(), {
      draft: { ...emptyDraft, subject: '不能丢失' },
      onSaveDraft,
    }));

    fireEvent.click(screen.getByRole('button', { name: '更多写信工具' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '保存并关闭' }));

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: '保存并关闭' }).hasAttribute('disabled')).toBe(false);
      expect(document.querySelector('.composer')?.hasAttribute('inert')).toBe(false);
    });
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe('保存失败，内容已保留：暂时无法连接草稿箱');
  });

  it.each(['blocked', 'empty'] as const)('keeps the save menu open when saving reports %s', async (status) => {
    const message = status === 'blocked' ? '附件仍在准备中' : '草稿为空，未保存';
    const onSaveDraft = vi.fn().mockResolvedValue({ status, message });
    render(cloneElement(composer(), { onSaveDraft }));
    fireEvent.click(screen.getByRole('button', { name: '更多写信工具' }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '保存并关闭' })); });

    expect(screen.getByRole('menu', { name: '更多写信工具' })).not.toBeNull();
    expect(screen.getByText(message)).not.toBeNull();
    expect(document.querySelector('.composer')?.hasAttribute('inert')).toBe(false);
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it.each(['preparing', 'failed'] as const)('explains why saving is unavailable for a %s attachment', (status) => {
    const onSaveDraft = vi.fn();
    const { rerender } = render(cloneElement(composer(), {
      onSaveDraft,
      attachmentImports: [{ id: 'file', filename: '资料.zip', sizeBytes: 10, status, progress: null, error: null, source: 'file', inline: false }],
    }));
    fireEvent.click(screen.getByRole('button', { name: '更多写信工具' }));
    const save = screen.getByRole('menuitem', { name: '保存并关闭' });
    expect(save.hasAttribute('disabled')).toBe(true);
    const explanation = document.getElementById(save.getAttribute('aria-describedby')!);
    expect(explanation?.textContent).toContain(status === 'preparing' ? '等待完成' : '重试或移除');
    fireEvent.click(save);
    expect(onSaveDraft).not.toHaveBeenCalled();
    rerender(cloneElement(composer(), { onSaveDraft, attachmentImports: [] }));
    expect(screen.getByRole('menuitem', { name: '保存并关闭' }).hasAttribute('disabled')).toBe(false);
    expect(document.querySelector('.composer-save-feedback')).toBeNull();
  });

  it('keeps a never-edited empty draft header focused on the window title', () => {
    render(composer());

    expect(screen.getByText('新邮件')).not.toBeNull();
    expect(screen.queryByText('未输入内容')).toBeNull();
  });

  it('keeps one window action set and supports collapsing contacts on desktop', () => {
    render(cloneElement(composer(), { defaultContactsOpen: true }));

    const dialog = screen.getByRole('dialog', { name: '写信窗口' });
    const contactsPanel = screen.getByRole('dialog', { name: '联系人' });
    expect(dialog.classList.contains('is-floating')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(contactsPanel.querySelector('[aria-label="收起写信"]')).toBeNull();
    expect(contactsPanel.querySelector('[aria-label="关闭写信窗口"]')).toBeNull();
    expect(contactsPanel.querySelector('[aria-label="返回写信"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: '切换联系人面板', hidden: true })).not.toBeNull();
    expect(screen.getAllByRole('button', { name: '收起写信', hidden: true })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '关闭写信窗口', hidden: true })).toHaveLength(1);
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

  it('configures standalone window chrome with titlebar drag region and platform attributes', () => {
    const { container, rerender } = render(cloneElement(composer(), { standaloneWindow: true, platform: 'macos' }));

    const dragRegion = container.querySelector('.composer-titlebar-drag-region');
    expect(dragRegion).not.toBeNull();
    expect(dragRegion?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(container.querySelector('.composer-backdrop')?.getAttribute('data-composer-platform')).toBe('macos');
    expect(screen.queryByRole('button', { name: '收起写信' })).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭写信窗口' })).toBeNull();

    rerender(cloneElement(composer(), { standaloneWindow: true, platform: 'windows' }));
    expect(container.querySelector('.composer-backdrop')?.getAttribute('data-composer-platform')).toBe('windows');
  });
});

describe('composer submission interaction lock', () => {
  it('locks the editor and send controls before progress is available and unlocks after completion', () => {
    const { container, rerender } = render(cloneElement(composer(), { submissionPending: true }));
    const panel = container.querySelector('.composer')!;
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: '提交中…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '提交中…' }).getAttribute('aria-busy')).toBe('true');
    rerender(cloneElement(composer(), { submissionPending: false }));
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(panel.hasAttribute('aria-busy')).toBe(false);
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('names active sending and uncertain delivery states without enabling a second send', () => {
    const { rerender } = render(cloneElement(composer(), { submissionPending: true, sendProgress: 60 }));
    expect((screen.getByRole('button', { name: '发送中…' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(cloneElement(composer(), { sendIssue: { kind: 'uncertain', message: '请核对发件箱' } }));
    expect((screen.getByRole('button', { name: '待核对' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('composer contacts container layout', () => {
  it('opens compact contacts as a modal drawer and returns keyboard focus on Escape', async () => {
    const { container } = render(cloneElement(composer(), { defaultContactsOpen: false }));
    const toggle = screen.getByRole('button', { name: '切换联系人面板' });
    toggle.focus();
    fireEvent.click(toggle);
    const contacts = screen.getByRole('dialog', { name: '联系人' });
    expect(contacts.getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('.composer-editor-pane')?.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '联系人' })).toBeNull();
    expect(container.querySelector('.composer-editor-pane')?.hasAttribute('inert')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });
  it('keeps contacts beside the editor in a sufficiently wide native window', () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
    try {
      const { container } = render(cloneElement(composer(), { standaloneWindow: true, defaultContactsOpen: true }));
      expect(screen.getByRole('complementary', { name: '联系人' })).not.toBeNull();
      expect(container.querySelector('.composer-editor-pane')?.hasAttribute('inert')).toBe(false);
      expect(screen.getByRole('textbox', { name: '主题' })).not.toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });
  it('rejects late field input while a submission is pending', () => {
    const onDraftChange = vi.fn();
    render(cloneElement(composer(), { submissionPending: true, onDraftChange, defaultContactsOpen: false }));
    fireEvent.change(screen.getByRole('textbox', { name: '主题' }), { target: { value: 'late input' } });
    expect(onDraftChange).not.toHaveBeenCalled();
  });
});
