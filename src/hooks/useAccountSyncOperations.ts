import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type {
  Account,
  AccountScope,
  FilterMode,
  Folder,
  ImapMailboxState,
  ImapProbeReport,
  MessageSummary,
  SyncRun,
} from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type AccountSyncOperationsOptions = {
  accountForm: Account | null;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  setImapProbe: Dispatch<SetStateAction<ImapProbeReport | null>>;
  setImapMailboxes: Dispatch<SetStateAction<ImapMailboxState[]>>;
  setSyncRuns?: Dispatch<SetStateAction<SyncRun[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  loadMeta: (
    nextFolderId?: number | null,
    nextScope?: AccountScope,
  ) => Promise<{ folderId: number | null; folders: Folder[] }>;
  loadMessages: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
  ) => Promise<MessageSummary[]>;
};

export default function useAccountSyncOperations({
  accountForm,
  folderId,
  query,
  filter,
  setImapProbe,
  setImapMailboxes,
  setSyncRuns,
  setStatus,
  loadMeta,
  loadMessages,
}: AccountSyncOperationsOptions) {
  const discoverImapFolders = useCallback(async () => {
    const report = await invoke<ImapProbeReport>(IPC.DiscoverImapFolders, { accountId: accountForm?.id });
    setImapProbe(report);
    const mailboxes = await invoke<ImapMailboxState[]>(IPC.ListImapMailboxes);
    setImapMailboxes(mailboxes);
    setStatus(report.message);
    return report;
  }, [accountForm?.id, setImapMailboxes, setImapProbe, setStatus]);

  const mapImapMailbox = useCallback(async (
    mailbox: ImapMailboxState,
    targetFolderId: number | null,
  ) => {
    const mapped = await invoke<ImapMailboxState>(IPC.MapImapMailbox, {
      mailboxId: mailbox.id,
      folderId: targetFolderId,
    });
    setImapMailboxes((current) => current.map((item) => (item.id === mapped.id ? mapped : item)));
    setStatus(
      mapped.local_folder_id
        ? `已将 ${mapped.remote_name} 映射到 ${mapped.local_folder_name}`
        : `已取消 ${mapped.remote_name} 的本地映射`,
    );
  }, [setImapMailboxes, setStatus]);

  const createAndMapImapMailbox = useCallback(async (mailbox: ImapMailboxState) => {
    const separator = mailbox.delimiter || '/';
    const suggestedName = mailbox.remote_name
      .split(separator)
      .map((part) => part.trim())
      .filter(Boolean)
      .pop() || mailbox.remote_name.trim() || '远端文件夹';
    const folder = await invoke<Folder>(IPC.CreateCustomFolder, {
      accountId: mailbox.account_id,
      name: suggestedName,
    });
    const mapped = await invoke<ImapMailboxState>(IPC.MapImapMailbox, {
      mailboxId: mailbox.id,
      folderId: folder.id,
    });
    setImapMailboxes((current) => current.map((item) => (item.id === mapped.id ? mapped : item)));
    await loadMeta(folderId);
    setStatus(`已创建 ${folder.name} 并映射远端目录 ${mapped.remote_name}`);
  }, [folderId, loadMeta, setImapMailboxes, setStatus]);

  const runSyncDryRun = useCallback(async () => {
    const run = await invoke<SyncRun>(IPC.RunSyncDryRun, { accountId: accountForm?.id });
    setSyncRuns?.((current) => [run, ...current].slice(0, 10));
    await loadMeta(folderId);
    setStatus('同步演练已完成并记录');
    return run;
  }, [accountForm?.id, folderId, loadMeta, setStatus, setSyncRuns]);

  const syncImapHistoryPage = useCallback(async (targetAccountId?: number | null) => {
    const run = await invoke<SyncRun>(IPC.SyncImapHistory, { accountId: targetAccountId ?? accountForm?.id });
    setSyncRuns?.((current) => [run, ...current].slice(0, 10));
    await loadMeta(folderId);
    await loadMessages(folderId, query, filter);
    setStatus(run.message);
    return run;
  }, [
    accountForm?.id,
    filter,
    folderId,
    loadMessages,
    loadMeta,
    query,
    setStatus,
    setSyncRuns,
  ]);

  return {
    discoverImapFolders,
    mapImapMailbox,
    createAndMapImapMailbox,
    runSyncDryRun,
    syncImapHistoryPage,
  };
}
