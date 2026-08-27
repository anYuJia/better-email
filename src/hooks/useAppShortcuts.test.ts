import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import useAppShortcuts from './useAppShortcuts';

afterEach(() => {
  cleanup();
});

function renderShortcuts(overrides: Partial<Parameters<typeof useAppShortcuts>[0]> = {}) {
  const searchInputRef = createRef<HTMLInputElement>();
  const handlers = {
    openComposer: vi.fn(),
    selectAdjacent: vi.fn(),
    composeReply: vi.fn(),
    toggleStar: vi.fn(),
    toggleRead: vi.fn(),
    archive: vi.fn(),
    moveTrash: vi.fn(),
    selectAllVisible: vi.fn(),
    undo: vi.fn(),
    openHelp: vi.fn(),
    closeHelp: vi.fn(),
  };
  renderHook(() => useAppShortcuts({
    searchInputRef,
    selectedId: 42,
    shortcutHelpOpen: false,
    confirmationOpen: false,
    ...handlers,
    ...overrides,
  }));
  return handlers;
}

describe('useAppShortcuts', () => {
  it('supports A as reply-all without replacing Cmd/Ctrl+A', () => {
    const handlers = renderShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(handlers.composeReply).toHaveBeenCalledWith('replyAll');
    expect(handlers.selectAllVisible).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(handlers.selectAllVisible).toHaveBeenCalledTimes(1);
  });

  it('supports # as a trash shortcut while preserving Delete', () => {
    const handlers = renderShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '#', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(handlers.moveTrash).toHaveBeenCalledTimes(2);
  });

  it('does not run mail shortcuts while typing', () => {
    const handlers = renderShortcuts();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '#', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(handlers.moveTrash).not.toHaveBeenCalled();
    expect(handlers.composeReply).not.toHaveBeenCalled();
    input.remove();
  });
});
