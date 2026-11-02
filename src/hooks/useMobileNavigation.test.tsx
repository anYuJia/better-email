import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMobileNavigation from './useMobileNavigation';
import type { SettingsSectionId } from '../components/settings/settingsNavigation';

const options = () => ({ isSettingsOpen: false, activeSettingsSection: 'general' as SettingsSectionId, setActiveSettingsSection: vi.fn(), setSettingsOpen: vi.fn() });

beforeEach(() => window.history.replaceState({ externalState: 'preserved' }, ''));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('useMobileNavigation history consistency', () => {
  it.each(['reader', 'settings'])('starts a fresh mailbox stack after reloading %s without its runtime state', (screen) => {
    window.history.replaceState({ externalState: 'preserved', betterEmailScreen: screen, betterEmailSearch: true, betterEmailSettingsSection: 'accounts', betterEmailSettingsDirection: 'forward' }, '');
    const callbacks = options();
    const { result } = renderHook(() => useMobileNavigation({ isMobileApp: true, ...callbacks }));
    expect(result.current.mobileScreen).toBe('mail');
    expect(result.current.mobileSearchOpen).toBe(false);
    expect(window.history.state).toEqual({ externalState: 'preserved', betterEmailScreen: 'mail' });
  });

  it('reconciles Back while on desktop before restoring the mobile surface', async () => {
    const callbacks = options();
    const { result, rerender } = renderHook(({ mobile }) => useMobileNavigation({ isMobileApp: mobile, ...callbacks }), { initialProps: { mobile: true } });
    act(() => result.current.navigateMobileScreen('reader'));
    expect(result.current.mobileScreen).toBe('reader');
    rerender({ mobile: false });
    act(() => window.history.back());
    await waitFor(() => expect(window.history.state.betterEmailScreen).toBe('mail'));
    rerender({ mobile: true });
    expect(result.current.mobileScreen).toBe('mail');
  });

  it('keeps one destination entry and restores search with browser Back and Forward', async () => {
    const callbacks = options();
    const { result } = renderHook(() => useMobileNavigation({ isMobileApp: true, ...callbacks }));
    act(() => result.current.openMobileSearch());
    const searchLength = window.history.length;
    act(() => result.current.navigateMobileScreen('reader'));
    act(() => result.current.navigateMobileScreen('reader'));
    expect(window.history.length).toBe(searchLength + 1);
    act(() => result.current.backMobileScreen());
    await waitFor(() => expect(result.current.mobileScreen).toBe('mail'));
    expect(result.current.mobileSearchOpen).toBe(true);
    act(() => window.history.forward());
    await waitFor(() => expect(result.current.mobileScreen).toBe('reader'));
    expect(result.current.mobileSearchOpen).toBe(false);
  });

  it('keeps a live reader and its history entry across a temporary desktop resize', () => {
    const callbacks = options();
    const { result, rerender } = renderHook(({ mobile }) => useMobileNavigation({ isMobileApp: mobile, ...callbacks }), { initialProps: { mobile: true } });
    act(() => result.current.navigateMobileScreen('reader'));
    const length = window.history.length;
    rerender({ mobile: false });
    rerender({ mobile: true });
    expect(result.current.mobileScreen).toBe('reader');
    expect(window.history.length).toBe(length);
    expect(window.history.state.betterEmailScreen).toBe('reader');
  });

  it('applies settings history and search state that changed while mobile was inactive', () => {
    const callbacks = options();
    const { result, rerender } = renderHook(({ mobile }) => useMobileNavigation({ isMobileApp: mobile, ...callbacks }), { initialProps: { mobile: true } });
    act(() => result.current.openMobileSearch());
    rerender({ mobile: false });
    window.history.replaceState({ betterEmailScreen: 'settings', betterEmailSettingsSection: 'accounts' }, '');
    rerender({ mobile: true });
    expect(result.current.mobileScreen).toBe('settings');
    expect(result.current.mobileSearchOpen).toBe(false);
    expect(callbacks.setActiveSettingsSection).toHaveBeenLastCalledWith('accounts');
    expect(callbacks.setSettingsOpen).toHaveBeenLastCalledWith(true);
  });

  it('does not take over browser history when the application stays on desktop', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    renderHook(() => useMobileNavigation({ isMobileApp: false, ...options() }));
    expect(replace).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ externalState: 'preserved' });
  });

  it('preserves a desktop Settings page on the first mobile handoff and gives it a root/detail Back path', async () => {
    const callbacks = options();
    const { result, rerender } = renderHook(({ mobile, open }) => useMobileNavigation({
      ...callbacks, isMobileApp: mobile, isSettingsOpen: open,
    }), { initialProps: { mobile: false, open: false } });
    rerender({ mobile: false, open: true });
    rerender({ mobile: true, open: true });
    expect(result.current.mobileScreen).toBe('settings');
    expect(window.history.state.betterEmailSettingsSection).toBe('general');
    expect(callbacks.setSettingsOpen).not.toHaveBeenCalledWith(false);
    act(() => result.current.backMobileScreen());
    await waitFor(() => expect(window.history.state.betterEmailSettingsSection).toBeUndefined());
    expect(result.current.mobileScreen).toBe('settings');
    expect(callbacks.setSettingsOpen).toHaveBeenLastCalledWith(false);
    act(() => result.current.backMobileScreen());
    await waitFor(() => expect(result.current.mobileScreen).toBe('mail'));
  });

  it.each<SettingsSectionId>(['general', 'privacy'])('keeps the current Settings detail through mobile/desktop/mobile (%s)', (desktopSection) => {
    const callbacks = options();
    const { result, rerender } = renderHook(({ mobile, open, section }) => useMobileNavigation({
      ...callbacks, isMobileApp: mobile, isSettingsOpen: open, activeSettingsSection: section,
    }), { initialProps: { mobile: true, open: false, section: 'general' as SettingsSectionId } });
    act(() => result.current.navigateMobileScreen('settings'));
    window.history.pushState({ betterEmailScreen: 'settings', betterEmailSettingsSection: 'general' }, '');
    rerender({ mobile: true, open: true, section: 'general' });
    rerender({ mobile: false, open: true, section: 'general' });
    const length = window.history.length;
    rerender({ mobile: false, open: true, section: desktopSection });
    rerender({ mobile: true, open: true, section: desktopSection });
    expect(result.current.mobileScreen).toBe('settings');
    expect(window.history.state.betterEmailSettingsSection).toBe(desktopSection);
    expect(window.history.length).toBe(length);
    expect(callbacks.setSettingsOpen).not.toHaveBeenCalledWith(false);
  });

  it('honors browser Back on desktop instead of reopening the stale Settings detail', async () => {
    const callbacks = options();
    const { result, rerender } = renderHook(({ mobile, open }) => useMobileNavigation({
      ...callbacks, isMobileApp: mobile, isSettingsOpen: open,
    }), { initialProps: { mobile: true, open: false } });
    act(() => result.current.navigateMobileScreen('settings'));
    window.history.pushState({ betterEmailScreen: 'settings', betterEmailSettingsSection: 'general' }, '');
    rerender({ mobile: true, open: true });
    rerender({ mobile: false, open: true });
    act(() => window.history.back());
    await waitFor(() => expect(window.history.state.betterEmailSettingsSection).toBeUndefined());
    rerender({ mobile: true, open: true });
    expect(result.current.mobileScreen).toBe('settings');
    expect(window.history.state.betterEmailSettingsSection).toBeUndefined();
    expect(callbacks.setSettingsOpen).toHaveBeenLastCalledWith(false);
  });

  it('does not reopen a Settings page the user closed on desktop', () => {
    const callbacks = options();
    const { result, rerender } = renderHook(({ mobile, open }) => useMobileNavigation({
      ...callbacks, isMobileApp: mobile, isSettingsOpen: open,
    }), { initialProps: { mobile: true, open: false } });
    act(() => result.current.navigateMobileScreen('settings'));
    window.history.pushState({ betterEmailScreen: 'settings', betterEmailSettingsSection: 'general' }, '');
    rerender({ mobile: true, open: true });
    rerender({ mobile: false, open: true });
    rerender({ mobile: false, open: false });
    rerender({ mobile: true, open: false });
    expect(result.current.mobileScreen).toBe('mail');
    expect(window.history.state.betterEmailScreen).toBe('mail');
    expect(window.history.state.betterEmailSettingsSection).toBeUndefined();
  });
});
