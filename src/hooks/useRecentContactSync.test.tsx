import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { invoke } from '../tauriBridge';
import useRecentContactSync from './useRecentContactSync';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

afterEach(cleanup);

describe('useRecentContactSync', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('uses the shared busy state and reports success for an explicit scan', async () => {
    let resolveScan: ((value: unknown) => void) | undefined;
    const scanResult = new Promise((resolve) => {
      resolveScan = resolve;
    });
    mockInvoke.mockReturnValueOnce(scanResult as Promise<never>);
    const refreshContacts = vi.fn().mockResolvedValue([]);
    const setStatus = vi.fn();
    const showToast = vi.fn();
    const { result } = renderHook(() => useRecentContactSync({
      accountsLength: 0,
      initialAccountListLoaded: false,
      gateActive: false,
      onboardingActive: false,
      refreshContacts,
      setStatus,
      showToast,
    }));

    let scanPromise: Promise<void> | undefined;
    act(() => {
      scanPromise = result.current.scanRecentContacts();
    });
    expect(result.current.scanBusy).toBe(true);
    expect(setStatus).toHaveBeenCalledWith('正在扫描已发送邮件头并同步最近联系人…');

    resolveScan?.({
      scanned_messages: 4,
      discovered_contacts: 3,
      created: 2,
      updated: 1,
      skipped: false,
    });
    await act(async () => {
      await scanPromise;
    });

    expect(refreshContacts).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenLastCalledWith('最近联系人同步完成：发现 3 位，新增 2 位');
    expect(showToast).toHaveBeenCalledWith('最近联系人同步成功：新增 2 位');
    expect(result.current.scanBusy).toBe(false);
  });

  it('runs the automatic scan once after the account list is ready', async () => {
    mockInvoke
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        scanned_messages: 1,
        discovered_contacts: 1,
        created: 1,
        updated: 0,
        skipped: false,
      });
    const refreshContacts = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useRecentContactSync({
      accountsLength: 1,
      initialAccountListLoaded: true,
      gateActive: false,
      onboardingActive: false,
      refreshContacts,
      setStatus: vi.fn(),
    }));

    await waitFor(() => expect(refreshContacts).toHaveBeenCalledTimes(1));
    expect(result.current.scanBusy).toBe(false);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'should_auto_scan_recent_contacts');
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'scan_recent_contacts', { initialOnly: true });
    expect(refreshContacts).toHaveBeenCalledTimes(1);
  });
});
