import { useCallback, useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMobileInboxSelection from './useMobileInboxSelection';
import useMobileNavigation from './useMobileNavigation';
import { mobileSelectionHistoryKey } from './mobileSelectionHistory';
import ContextMenu from '../components/ContextMenu';
import MessageDateRangePicker from '../components/MessageDateRangePicker';
import type { ListMode } from '../app/types';

beforeEach(() => {
  window.history.replaceState({ betterEmailScreen: 'mail', externalState: 'preserved' }, '');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const cleared = vi.fn();
  return { cleared, ...renderHook(({ key, mode, mobile = true }: { key: string; mode: ListMode; mobile?: boolean }) => {
    const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
    const clearSelection = useCallback(() => { cleared(); setSelectedMessageIds([]); }, []);
    const navigation = useMobileNavigation({ isMobileApp: mobile, isSettingsOpen: false, activeSettingsSection: 'general', setActiveSettingsSection: vi.fn(), setSettingsOpen: vi.fn() });
    const selection = useMobileInboxSelection({ isMobileApp: mobile, mobileScreen: navigation.mobileScreen, mobileSearchOpen: navigation.mobileSearchOpen,
      listMode: mode, mailboxUnavailable: false, mailboxListStateKey: key, selectedMessageIds, messageCount: 20, clearSelection });
    return { ...navigation, ...selection, selectedMessageIds, setSelectedMessageIds };
  }, { initialProps: { key: 'inbox', mode: 'messages' } as { key: string; mode: ListMode; mobile?: boolean } }) };
}
async function back() { act(() => window.history.back()); await waitFor(() => expect(window.history.state?.[mobileSelectionHistoryKey]).toBeUndefined()); }

describe('mobile selection owns one transient history layer', () => {
  it('lets Back exit an empty selection and does not push duplicate entries for repeated entry', async () => {
    const { result, cleared } = setup(); const length = window.history.length;
    act(() => { result.current.headerSelectionProps.onEnterSelection(); result.current.headerSelectionProps.onEnterSelection(); });
    expect(result.current.mobileSelectionMode).toBe(true);
    expect(result.current.selectionShortcutsProps.selectionMode).toBe(true);
    expect(window.history.length).toBe(length + 1);
    await back();
    expect(result.current.mobileSelectionMode).toBe(false);
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(result.current.mobileScreen).toBe('mail');
    expect(window.history.state.externalState).toBe('preserved');
  });

  it('consumes its history layer on explicit exit and never resurrects it through Forward', async () => {
    const { result } = setup(); const historyBack = vi.spyOn(window.history, 'back');
    act(() => result.current.headerSelectionProps.onEnterSelection());
    act(() => result.current.selectionShortcutsProps.clearSelection());
    await waitFor(() => expect(window.history.state?.[mobileSelectionHistoryKey]).toBeUndefined());
    expect(result.current.mobileSelectionMode).toBe(false);
    act(() => window.history.forward());
    await waitFor(() => expect(historyBack).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(window.history.state?.[mobileSelectionHistoryKey]).toBeUndefined());
    expect(result.current.mobileSelectionMode).toBe(false);
  });

  it('supports a rapid new entry before the previous explicit Back has completed', async () => {
    const { result } = setup();
    const pushState = vi.spyOn(window.history, 'pushState');
    act(() => result.current.headerSelectionProps.onEnterSelection());
    act(() => { result.current.headerSelectionProps.onExitSelection(); result.current.headerSelectionProps.onEnterSelection(); });
    await waitFor(() => expect(pushState).toHaveBeenCalledTimes(2));
    expect(result.current.mobileSelectionMode).toBe(true);
    expect(window.history.state?.[mobileSelectionHistoryKey]).toBeTruthy();
    await back(); expect(result.current.mobileSelectionMode).toBe(false);
  });

  it('restores the existing search layer and leaves its own subsequent Back intact', async () => {
    const { result } = setup();
    act(() => result.current.openMobileSearch());
    act(() => result.current.headerSelectionProps.onEnterSelection());
    await back();
    expect(result.current.mobileSearchOpen).toBe(true);
    expect(window.history.state.betterEmailSearch).toBe(true);
    act(() => result.current.closeMobileSearch());
    await waitFor(() => expect(result.current.mobileSearchOpen).toBe(false));
    expect(result.current.mobileScreen).toBe('mail');
  });

  it('releases a pending selection history layer during a desktop handoff and allows another mobile entry', async () => {
    const { result, rerender } = setup();
    act(() => result.current.headerSelectionProps.onEnterSelection());
    rerender({ key: 'inbox', mode: 'messages', mobile: false });
    await waitFor(() => expect(window.history.state?.[mobileSelectionHistoryKey]).toBeUndefined());
    rerender({ key: 'inbox', mode: 'messages', mobile: true });
    act(() => result.current.headerSelectionProps.onEnterSelection());
    expect(window.history.state?.[mobileSelectionHistoryKey]).toBeTruthy();
    expect(result.current.mobileSelectionMode).toBe(true);
    await back(); expect(result.current.mobileSelectionMode).toBe(false);
  });

  it.each(['search', 'settings', 'reader'] as const)('replaces the selection layer with %s without an empty intermediate Back step', async (destination) => {
    const { result, cleared } = setup();
    act(() => { result.current.headerSelectionProps.onEnterSelection(); result.current.setSelectedMessageIds([1]); });
    const length = window.history.length;
    act(() => { if (destination === 'search') result.current.openMobileSearch(); else result.current.navigateMobileScreen(destination); });
    expect(result.current.mobileSelectionMode).toBe(false);
    expect(cleared).toHaveBeenCalled();
    expect(window.history.length).toBe(length);
    expect(window.history.state?.[mobileSelectionHistoryKey]).toBeUndefined();
    act(() => window.history.back());
    await waitFor(() => expect(result.current.mobileScreen === 'mail' && !result.current.mobileSearchOpen).toBe(true));
  });

  it.each(['mode', 'folder'] as const)('clears ids and pending-operation ownership on %s change', async (change) => {
    const { result, rerender, cleared } = setup();
    act(() => { result.current.headerSelectionProps.onEnterSelection(); result.current.setSelectedMessageIds([1]); });
    rerender({ key: change === 'folder' ? 'sent' : 'inbox', mode: change === 'mode' ? 'threads' : 'messages' });
    await waitFor(() => expect(window.history.state?.[mobileSelectionHistoryKey]).toBeUndefined());
    expect(result.current.mobileSelectionMode).toBe(false);
    expect(result.current.selectedMessageIds).toEqual([]);
    expect(cleared).toHaveBeenCalled();
  });

  it.each(['menu', 'date'] as const)('Back closes the %s first, then a second Back exits selection', async (popup) => {
    const { result, cleared } = setup();
    act(() => result.current.headerSelectionProps.onEnterSelection());
    function Popup() {
      const [open, setOpen] = useState(true);
      return popup === 'menu' ? <ContextMenu menu={open ? { x: 20, y: 20, items: [{ id: 'action', label: '操作', onSelect: vi.fn() }], onClose: () => setOpen(false) } : null} />
        : <MessageDateRangePicker onConfirm={vi.fn()} />;
    }
    render(<Popup />);
    if (popup === 'date') fireEvent.click(screen.getByRole('button', { name: '按日期选择邮件' }));
    act(() => window.history.back());
    await waitFor(() => expect(document.querySelector(popup === 'menu' ? '.context-menu:not([aria-hidden="true"])' : '.message-date-range-modal')).toBeNull());
    expect(result.current.mobileSelectionMode).toBe(true);
    expect(window.history.state?.[mobileSelectionHistoryKey]).toBeTruthy();
    expect(cleared).not.toHaveBeenCalled();
    await back(); expect(result.current.mobileSelectionMode).toBe(false);
  });
});
