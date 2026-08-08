import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import useAppShortcuts from './useAppShortcuts';
import type { MessageSummary } from '../app/types';

type ShortcutOptions = Parameters<typeof useAppShortcuts>[0];

function ShortcutHarness({ options }: { options: ShortcutOptions }) {
  useAppShortcuts(options);
  return null;
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
    moveSelected: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

describe('useAppShortcuts text selection boundary', () => {
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
});
