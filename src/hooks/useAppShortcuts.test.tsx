import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import useAppShortcuts from './useAppShortcuts';
import { useDetailsMenu } from './useDetailsMenu';
import { ContextMenuContent } from '../components/ContextMenu';
import { CustomSelect } from '../components/settings/accounts/CustomSelect';
import type { MessageSummary } from '../app/types';

type ShortcutOptions = Parameters<typeof useAppShortcuts>[0];

function ShortcutHarness({ options }: { options: ShortcutOptions }) {
  useAppShortcuts(options);
  return null;
}

function MenuShortcutHarness({ options }: { options: ShortcutOptions }) {
  useAppShortcuts(options);
  const ref = useRef<HTMLDetailsElement>(null);
  const menu = useDetailsMenu(ref);
  return (
    <details ref={ref}>
      <summary>更多邮件操作</summary>
      <div data-floating-menu-panel="true">
        <ContextMenuContent items={[{ id: 'export', label: '导出邮件' }]} onClose={menu.closeMenu} />
      </div>
    </details>
  );
}

function makeOptions(): ShortcutOptions {
  return {
    searchInputRef: { current: null },
    messages: [{ id: 1 }] as MessageSummary[],
    selected: null,
    selectedId: null,
    selectedMessages: [],
    selectedMessageIds: [],
    listMode: 'messages',
    undoAction: null,
    isComposerOpen: false,
    isComposerMinimized: false,
    isComposerModal: false,
    isSettingsOpen: false,
    isShortcutsOpen: false,
    isAccountLoginRequired: false,
    closeOverlays: vi.fn(),
    clearSelection: vi.fn(),
    setStatus: vi.fn(),
    restoreUndoAction: vi.fn(async () => undefined),
    toggleAllVisibleMessages: vi.fn(),
    openShortcuts: vi.fn(),
    composeNew: vi.fn(),
    setSelectedId: vi.fn(),
    runBulkAction: vi.fn(async () => undefined),
    composeFromMessage: vi.fn(),
    toggleStar: vi.fn(async () => undefined),
    toggleRead: vi.fn(async () => undefined),
    moveMessage: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

describe('useAppShortcuts text selection boundary', () => {
  it('exits explicit selection with Escape before any message is selected', () => {
    const options = { ...makeOptions(), selectionMode: true };
    render(<ShortcutHarness options={options} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(options.clearSelection).toHaveBeenCalledOnce();
  });

  it('closes an open menu before Escape exits an empty touch selection', () => {
    const options = { ...makeOptions(), selectionMode: true };
    render(<MenuShortcutHarness options={options} />);
    const trigger = screen.getByRole('button', { name: '更多邮件操作' });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(options.clearSelection).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(options.clearSelection).toHaveBeenCalledOnce();
  });

  it.each(['composer', 'settings'] as const)('lets Escape close %s when a custom select is closed', (surface) => {
    const options = makeOptions();
    options.isComposerOpen = surface === 'composer';
    options.isSettingsOpen = surface === 'settings';
    render(<>
      <ShortcutHarness options={options} />
      <CustomSelect value="default" options={[{ value: 'default', label: '默认' }]} onChange={vi.fn()} ariaLabel="账号" />
    </>);
    const trigger = screen.getByRole('combobox', { name: '账号' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(options.closeOverlays).toHaveBeenCalledOnce();
  });

  it('keeps the first Escape inside an open custom select, then closes its owning surface', () => {
    const options = makeOptions();
    options.isComposerOpen = true;
    render(<>
      <ShortcutHarness options={options} />
      <CustomSelect value="default" options={[{ value: 'default', label: '默认' }]} onChange={vi.fn()} ariaLabel="账号" />
    </>);
    const trigger = screen.getByRole('combobox', { name: '账号' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Mailbox commands must stay blocked even before the menu's enter frame.
    fireEvent.keyDown(window, { key: 'c' });
    expect(options.composeNew).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(options.closeOverlays).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(options.closeOverlays).toHaveBeenCalledOnce();
  });

  it.each([false, true])('keeps all mailbox shortcuts inside an open menu (bulk selection: %s)', (bulk) => {
    const options = makeOptions();
    const message = { id: 1, folder_role: 'inbox', is_read: true, is_starred: false } as MessageSummary;
    options.messages = [message, { ...message, id: 2 }];
    options.selected = message;
    options.selectedId = 1;
    options.undoAction = {} as NonNullable<ShortcutOptions['undoAction']>;
    if (bulk) {
      options.selectedMessages = [message];
      options.selectedMessageIds = [1];
    }
    render(<MenuShortcutHarness options={options} />);
    const trigger = screen.getByRole('button', { name: '更多邮件操作' });
    fireEvent.click(trigger);
    const details = trigger.parentElement as HTMLDetailsElement;
    fireEvent(details, new Event('toggle'));
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '导出邮件' }));
    // Also exercise the trigger: it can own focus during native toggle/paint.
    trigger.focus();
    for (const key of ['ArrowDown', 'ArrowUp', 'j', 'k', 's', 'm', 'e', '#', 'Delete', 'Backspace', 'r', 'f', 'a', 'c', '?']) {
      fireEvent.keyDown(trigger, { key });
    }
    fireEvent.keyDown(trigger, { key: 'a', metaKey: true });
    fireEvent.keyDown(trigger, { key: 'z', metaKey: true });
    for (const name of ['setSelectedId', 'toggleStar', 'toggleRead', 'moveMessage', 'runBulkAction', 'composeFromMessage', 'composeNew', 'toggleAllVisibleMessages', 'restoreUndoAction', 'openShortcuts'] as const) {
      expect(options[name]).not.toHaveBeenCalled();
    }
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: 'Delete' });
    if (bulk) expect(options.runBulkAction).toHaveBeenCalledWith('trash');
    else expect(options.moveMessage).toHaveBeenCalledWith(options.selected, 'trash');
  });

  it('keeps command-a available to the browser while text is selected', () => {
    const options = makeOptions();
    render(<ShortcutHarness options={options} />);

    const text = document.createTextNode('mail body text');
    document.body.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);

    fireEvent.keyDown(window, { key: 'a', metaKey: true });

    expect(options.toggleAllVisibleMessages).not.toHaveBeenCalled();
    expect(options.setStatus).not.toHaveBeenCalled();
  });

  it('still selects the visible message list when no text range is active', () => {
    const options = makeOptions();
    render(<ShortcutHarness options={options} />);

    fireEvent.keyDown(window, { key: 'a', metaKey: true });

    expect(options.toggleAllVisibleMessages).toHaveBeenCalledWith(true);
    expect(options.setStatus).toHaveBeenCalledWith('已选择当前列表 1 封邮件');
  });

  it('ignores app shortcuts while an account login is required', () => {
    const options = makeOptions();
    options.isAccountLoginRequired = true;
    render(<ShortcutHarness options={options} />);

    fireEvent.keyDown(window, { key: 'c' });
    fireEvent.keyDown(window, { key: '?' });

    expect(options.composeNew).not.toHaveBeenCalled();
    expect(options.openShortcuts).not.toHaveBeenCalled();
  });

  it('ignores app shortcuts while the first-run onboarding gate is active', () => {
    // App 层把「首次引导进行中」并入 isAccountLoginRequired（门禁状态），
    // 写邮件、快捷键帮助、批量选择、回复等都不能穿透引导。
    const options = makeOptions();
    options.isAccountLoginRequired = true;
    options.isSettingsOpen = true;
    render(<ShortcutHarness options={options} />);

    fireEvent.keyDown(window, { key: 'c' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(options.composeNew).not.toHaveBeenCalled();
    expect(options.closeOverlays).not.toHaveBeenCalled();
  });

  it('ignores app shortcuts while the image preview modal is open', () => {
    const options = makeOptions();
    render(<ShortcutHarness options={options} />);
    document.body.dataset.imagePreviewModal = '1';

    fireEvent.keyDown(window, { key: 'c' });

    expect(options.composeNew).not.toHaveBeenCalled();
    delete document.body.dataset.imagePreviewModal;
  });

  it('keeps native scrolling and selection in the reader while J still opens the next message', () => {
    const options = makeOptions();
    render(<><ShortcutHarness options={options} /><section className="reader-panel" tabIndex={0}>正文</section></>);
    const reader = document.querySelector<HTMLElement>('.reader-panel')!;
    reader.focus();
    expect(fireEvent.keyDown(reader, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(reader, { key: 'ArrowUp' })).toBe(true);
    expect(fireEvent.keyDown(reader, { key: 'a', ctrlKey: true })).toBe(true);
    expect(options.setSelectedId).not.toHaveBeenCalled();
    expect(options.toggleAllVisibleMessages).not.toHaveBeenCalled();
    fireEvent.keyDown(reader, { key: 'j' });
    expect(options.setSelectedId).toHaveBeenCalled();
  });

  it('navigates and archives from the focused row when the reader is showing another message', () => {
    const options = makeOptions();
    options.messages = [1, 2, 3].map((id) => ({ id, folder_role: 'inbox' } as MessageSummary));
    options.selected = options.messages[0];
    options.selectedId = 1;
    render(<><ShortcutHarness options={options} /><div className="message-list"><div className="message-card" data-message-id="2"><button>第二封</button></div></div></>);
    const row = document.querySelector('button')!;
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    expect(options.setSelectedId).toHaveBeenCalledWith(3);
    fireEvent.keyDown(row, { key: 'e' });
    expect(options.moveMessage).toHaveBeenCalledWith(options.messages[1], 'archive');
  });

  it('allows select-all and cancel from a message checkbox without intercepting text fields', () => {
    const options = makeOptions();
    options.selectedMessageIds = [1];
    render(<><ShortcutHarness options={options} /><section className="message-list-panel"><input type="checkbox" /><input /></section></>);
    const [checkbox, input] = document.querySelectorAll('.message-list-panel input');
    fireEvent.keyDown(checkbox, { key: 'a', metaKey: true });
    fireEvent.keyDown(checkbox, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(options.toggleAllVisibleMessages).toHaveBeenCalledTimes(1);
    expect(options.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('focuses the global search input with the command shortcut', () => {
    const options = makeOptions();
    const input = document.createElement('input');
    document.body.append(input);
    options.searchInputRef = { current: input };
    render(<ShortcutHarness options={options} />);

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(document.activeElement).toBe(input);
  });

  it('does not move the underlying message selection while the conversation list owns arrow keys', () => {
    const options = makeOptions();
    options.listMode = 'threads';
    options.selectedId = 1;
    render(<ShortcutHarness options={options} />);

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'j' });

    expect(options.setSelectedId).not.toHaveBeenCalled();
  });

  it('moves conversation selection using j/k and ArrowDown/ArrowUp in thread mode', () => {
    const threadA = {
      thread_key: 'thread-1',
      subject: '会话 1',
      participants: 'Alice',
      message_count: 2,
      unread_count: 0,
      latest_at: '2026-11-13T10:00:00Z',
      latest_preview: '测试预览 1',
    };
    const threadB = {
      thread_key: 'thread-2',
      subject: '会话 2',
      participants: 'Bob',
      message_count: 3,
      unread_count: 1,
      latest_at: '2026-11-13T11:00:00Z',
      latest_preview: '测试预览 2',
    };
    const onOpenThread = vi.fn();
    const options = makeOptions();
    options.listMode = 'threads';
    options.threads = [threadA, threadB];
    options.activeThread = threadA;
    options.onOpenThread = onOpenThread;
    render(<ShortcutHarness options={options} />);

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onOpenThread).toHaveBeenCalledWith(threadB);

    options.activeThread = threadB;
    fireEvent.keyDown(window, { key: 'k' });
    expect(onOpenThread).toHaveBeenCalledWith(threadA);
  });

  it('clears a selection when only closed anchored menu surfaces exist', () => {
    const options = makeOptions();
    options.selectedMessageIds = [1];
    const anchoredSurface = document.createElement('div');
    anchoredSurface.className = 'context-menu-surface context-menu--anchored';
    document.body.append(anchoredSurface);
    render(<ShortcutHarness options={options} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(options.clearSelection).toHaveBeenCalledOnce();
    expect(options.setStatus).toHaveBeenCalledWith('已取消邮件选择');
    anchoredSurface.remove();
  });

  it('does not let a retained inert context exit swallow the next Escape', () => {
    const options = makeOptions();
    options.isComposerOpen = true;
    const outgoing = document.createElement('div');
    outgoing.className = 'context-menu context-menu-surface';
    outgoing.setAttribute('aria-hidden', 'true');
    outgoing.setAttribute('inert', '');
    document.body.append(outgoing);
    render(<ShortcutHarness options={options} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(options.closeOverlays).toHaveBeenCalledOnce();
    outgoing.remove();
  });

  it('leaves Escape to an open floating context menu', () => {
    const options = makeOptions();
    options.selectedMessageIds = [1];
    const floatingMenu = document.createElement('div');
    floatingMenu.className = 'context-menu context-menu-surface';
    document.body.append(floatingMenu);
    render(<ShortcutHarness options={options} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(options.clearSelection).not.toHaveBeenCalled();
    floatingMenu.remove();
  });
});
