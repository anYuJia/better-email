import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useStandaloneSettingsLifecycle from './useStandaloneSettingsLifecycle';

const native = vi.hoisted(() => ({ emit: vi.fn(), close: vi.fn() }));
vi.mock('../tauriBridge', () => ({
  SETTINGS_CLOSED_EVENT: 'settings-closed',
  emitToMain: native.emit,
  closeCurrentWindow: native.close,
}));

describe('standalone settings lifecycle', () => {
  beforeEach(() => {
    native.emit.mockReset().mockResolvedValue(undefined);
    native.close.mockReset().mockResolvedValue(undefined);
  });

  it('loads metadata once and updates the requested section', async () => {
    const loadMeta = vi.fn().mockResolvedValue({ folderId: 1, folders: [] });
    const setSection = vi.fn();
    const setStatus = vi.fn();
    const { rerender } = renderHook(({ section, folderId }) => useStandaloneSettingsLifecycle({
      standalone: true, isOpen: true, requestedSection: section, folderId,
      accountScope: 2, loadMeta, setSection, setStatus,
    }), { initialProps: { section: 'general' as const, folderId: 1 } });
    await waitFor(() => expect(loadMeta).toHaveBeenCalledTimes(1));
    rerender({ section: 'general', folderId: 3 });
    expect(loadMeta).toHaveBeenCalledTimes(1);
    expect(setSection).toHaveBeenCalledWith('general');
    expect(native.close).not.toHaveBeenCalled();
  });

  it('notifies the main window before closing and reports close errors', async () => {
    const setStatus = vi.fn();
    native.close.mockRejectedValue(new Error('close failed'));
    renderHook(() => useStandaloneSettingsLifecycle({
      standalone: true, isOpen: false, requestedSection: 'general', folderId: null,
      accountScope: 'all', loadMeta: vi.fn().mockResolvedValue({ folderId: null, folders: [] }),
      setSection: vi.fn(), setStatus,
    }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('无法关闭设置窗口：Error: close failed'));
    expect(native.emit).toHaveBeenCalledWith('settings-closed');
    expect(native.emit.mock.invocationCallOrder[0]).toBeLessThan(native.close.mock.invocationCallOrder[0]);
    await act(async () => {});
  });
});
