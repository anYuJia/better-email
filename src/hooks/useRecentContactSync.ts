import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { logError } from '../app/logger';
import type { RecentContactSyncReport } from '../app/types';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';

type RecentContactSyncOptions = {
  accountsLength: number;
  initialAccountListLoaded: boolean;
  gateActive: boolean;
  onboardingActive: boolean;
  refreshContacts: () => Promise<unknown>;
  setStatus: Dispatch<SetStateAction<string>>;
  showToast?: (text: string) => void;
};

export default function useRecentContactSync({
  accountsLength,
  initialAccountListLoaded,
  gateActive,
  onboardingActive,
  refreshContacts,
  setStatus,
  showToast,
}: RecentContactSyncOptions) {
  const [scanBusy, setScanBusy] = useState(false);
  const scanBusyRef = useRef(false);
  const initialScanCheckedRef = useRef(false);

  const scanRecentContacts = useCallback(async () => {
    if (scanBusyRef.current) return;
    scanBusyRef.current = true;
    setScanBusy(true);
    setStatus('正在扫描已发送邮件头并同步最近联系人…');
    try {
      const report = await invoke<RecentContactSyncReport>(IPC.ScanRecentContacts, { initialOnly: false });
      await refreshContacts();
      setStatus(`最近联系人同步完成：发现 ${report.discovered_contacts} 位，新增 ${report.created} 位`);
      showToast?.(`最近联系人同步成功：新增 ${report.created} 位`);
    } catch (error) {
      logError(error);
      setStatus(`最近联系人同步失败：${String(error)}`);
    } finally {
      scanBusyRef.current = false;
      setScanBusy(false);
    }
  }, [refreshContacts, setStatus, showToast]);

  useEffect(() => {
    if (
      initialScanCheckedRef.current
      || !initialAccountListLoaded
      || accountsLength === 0
      || gateActive
      || onboardingActive
    ) return;
    initialScanCheckedRef.current = true;
    let active = true;
    void invoke<boolean>(IPC.ShouldAutoScanRecentContacts)
      .then(async (needed) => {
        if (!active || !needed) return;
        if (scanBusyRef.current) return;
        scanBusyRef.current = true;
        setScanBusy(true);
        try {
          await invoke<RecentContactSyncReport>(IPC.ScanRecentContacts, { initialOnly: true });
          if (active) await refreshContacts();
        } catch (error) {
          logError(error);
          if (active) setStatus(`首次联系人同步失败：${String(error)}`);
        } finally {
          scanBusyRef.current = false;
          if (active) setScanBusy(false);
        }
      })
      .catch((error) => {
        logError(error);
        if (active) setStatus(`无法检查首次联系人同步状态：${String(error)}`);
      });
    return () => { active = false; };
  }, [accountsLength, gateActive, initialAccountListLoaded, onboardingActive, refreshContacts, setStatus]);

  return { scanBusy, initialScanBusy: scanBusy, scanRecentContacts };
}
