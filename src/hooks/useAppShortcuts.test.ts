import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import type { MessageSummary } from '../app/types';
import useAppShortcuts from './useAppShortcuts';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const selectedMessage: MessageSummary = {
  id: 42,
  account_id: 1,
  account_email: 'me@example.com',
  folder_id: 1,
  folder_role: 'inbox',
  sender_name: 'Ada',
  sender_email: 'ada@example.com',
  recipients: 'me@example.com',
  cc: '',
  bcc: '',
  subject: 'Hello',
  snippet: 'Hi',
  security_warnings: [],
  received_at: '2026-08-27T00:00:00Z',
  is_read: true,
  is_starred: false,
  has_attachments: false,
  snoozed_until: '',
  labels: [],
  attachment_count: 0,
  remote_mailbox: 'INBOX',
  remote_uid: 42,
  message_id_header: '',
  in_reply_to_header: '',
  references_header: '',
};

function renderShortcuts(overrides: Partial<Parameters<typeof useAppShortcuts>[0]> = {}) {
  const searchInputRef = createRef<HTMLInputElement>();
  const handlers = {
    closeOverlays: vi.fn(),
    clearSelection: vi.fn(),
    setStatus: vi.fn(),
    restoreUndoAction: vi.fn(async () => undefined),
    toggleAllVisibleMessages: vi.fn(async () => 1),
    openShortcuts: vi.fn(),
    composeNew: vi.fn(),
    setSelectedId: vi.fn(),
    runBulkAction: vi.fn(async () => undefined),
    composeFromMessage: vi.fn(),
    toggleStar: vi.fn(async () => undefined),
    toggleRead: vi.fn(async () => undefined),
    moveSelected: vi.fn(async () => undefined),
  };

  renderHook(() => useAppShortcuts({
    searchInputRef,
    messages: [selectedMessage],
    selected: selectedMessage,
    selectedId: selectedMessage.id,
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
    ...handlers,
    ...overrides,
  }));

  return handlers;
}

describe('useAppShortcuts', () => {
  it('supports A as reply-all without replacing Cmd/Ctrl+A', () => {
    const handlers = renderShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(handlers.composeFromMessage).toHaveBeenCalledWith(selectedMessage, 'replyAll');
    expect(handlers.toggleAllVisibleMessages).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(handlers.toggleAllVisibleMessages).toHaveBeenCalledTimes(1);
  });

  it('supports # as a trash shortcut while preserving Delete', () => {
    const handlers = renderShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '#', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(handlers.moveSelected).toHaveBeenNthCalledWith(1, 'trash');
    expect(handlers.moveSelected).toHaveBeenNthCalledWith(2, 'trash');
  });

  it('does not run mail shortcuts while typing', () => {
    const handlers = renderShortcuts();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '#', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(handlers.moveSelected).not.toHaveBeenCalled();
    expect(handlers.composeFromMessage).not.toHaveBeenCalled();
  });

  it('keeps bulk trash behavior when messages are selected', () => {
    const handlers = renderShortcuts({ selectedMessages: [selectedMessage] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '#', bubbles: true, cancelable: true }));
    expect(handlers.runBulkAction).toHaveBeenCalledWith('trash');
    expect(handlers.moveSelected).not.toHaveBeenCalled();
  });

  it('does not intercept arrow keys or mail navigation when focused inside an overlay or dropdown', () => {
    const handlers = renderShortcuts({
      messages: [selectedMessage, { ...selectedMessage, id: 43 }],
      selectedId: 42,
    });

    const overlay = document.createElement('div');
    overlay.className = 'message-date-picker-popover';
    const monthButton = document.createElement('button');
    overlay.appendChild(monthButton);
    document.body.appendChild(overlay);
    monthButton.focus();

    monthButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(handlers.setSelectedId).not.toHaveBeenCalled();

    monthButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
    expect(handlers.setSelectedId).not.toHaveBeenCalled();
  });

  it('respects defaultPrevented events from local components', () => {
    const handlers = renderShortcuts({
      messages: [selectedMessage, { ...selectedMessage, id: 43 }],
      selectedId: 42,
    });

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);

    expect(handlers.setSelectedId).not.toHaveBeenCalled();
  });

  it('does not change background message selection when a context menu or date picker is open', () => {
    const handlers = renderShortcuts({
      messages: [selectedMessage, { ...selectedMessage, id: 43 }],
      selectedId: 42,
    });

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    document.body.appendChild(menu);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(handlers.setSelectedId).not.toHaveBeenCalled();
  });
});
