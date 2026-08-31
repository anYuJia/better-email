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
