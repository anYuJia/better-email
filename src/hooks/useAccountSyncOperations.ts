import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { runProviderValidation, type ProviderValidationReport } from '../app/providerValidation';
import { credentialVerificationPatch } from '../app/accountConnectionFlows';
import type {
  Account,
  AccountScope,
  ConnectionReport,
  CredentialVerificationReport,
  FilterMode,
  Folder,
  ImapMailboxState,
  ImapProbeReport,
  MessageSummary,
  ProviderVerificationRecord,
  SyncRun,
} from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type AccountSyncOperationsOptions = {
  accountForm: Account | null;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  setConnectionReport: Dispatch<SetStateAction<ConnectionReport | null>>;
  setCredentialVerification: Dispatch<SetStateAction<CredentialVerificationReport | null>>;
  setImapProbe: Dispatch<SetStateAction<ImapProbeReport | null>>;
  setImapMailboxes: Dispatch<SetStateAction<ImapMailboxState[]>>;
  setSyncRuns?: Dispatch<SetStateAction<SyncRun[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  updateProviderVerification: (
    providerName: string,
    patch: Partial<ProviderVerificationRecord>,
  ) => void;
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
  setConnectionReport,
  setCredentialVerification,
  setImapProbe,
  setImapMailboxes,
  setSyncRuns,
  setStatus,
  updateProviderVerification,
  loadMeta,
  loadMessages,
}: AccountSyncOperationsOptions) {
  const [providerValidationReport, setProviderValidationReport] = useState<ProviderValidationReport | null>(null);
  const [providerValidationRunning, setProviderValidationRunning] = useState(false);
  const providerValidationRunId = useRef(0);

  const discoverImapFolders = useCallback(async () => {
    const report = await invoke<ImapProbeReport>(IPC.DiscoverImapFolders, { accountId: accountForm?.id });
    setImapProbe(report);
    const mailboxes = await invoke<ImapMailboxState[]>(IPC.ListImapMailboxes);
    setImapMailboxes(mailboxes);
    setStatus(report.message);
    return report;
  }, [accountForm?.id, setImapMailboxes, setImapProbe, setStatus]);

  const runReadOnlyProviderValidation = useCallback(async () => {
    if (!accountForm || providerValidationRunning) return null;
    const validationAccount = accountForm;
    const runId = ++providerValidationRunId.current;
    setProviderValidationRunning(true);
    try {
      const report = await runProviderValidation(validationAccount.email, {
        incomingProtocol: validationAccount.incoming_protocol,
        testConnection: async () => {
          const result = await invoke<ConnectionReport>(IPC.TestConnection, {
            accountId: validationAccount.id,
          });
          setConnectionReport(result);
          return result;
        },
        verifyCredentials: async () => {
          const result = await invoke<CredentialVerificationReport>(IPC.VerifyAccountCredentials, {
            accountId: validationAccount.id,
          });
          setCredentialVerification(result);
          if (result.status !== 'credential_error') {
            updateProviderVerification(
              validationAccount.provider,
              credentialVerificationPatch(result, validationAccount.auth_type),
            );
          }
          return result;
        },
        discoverFolders: async () => {
          if (validationAccount.incoming_protocol === 'pop3') {
            const result: ImapProbeReport = {
              account_email: validationAccount.email,
              checked_at: new Date().toISOString(),
              status: 'ok',
              folder_count: 1,
              folders: [],
              message: 'POP3 账号使用收件箱同步，无需远端文件夹发现。',
            };
            setImapProbe(result);
            setImapMailboxes([]);
            return result;
          }
          const result = await invoke<ImapProbeReport>(IPC.DiscoverImapFolders, {
            accountId: validationAccount.id,
          });
          setImapProbe(result);
          const mailboxes = await invoke<ImapMailboxState[]>(IPC.ListImapMailboxes);
          setImapMailboxes(mailboxes);
          return result;
        },
        syncHeaders: async () => {
          const result = await invoke<SyncRun>(IPC.SyncImapHeaders, {
            accountId: validationAccount.id,
          });
          setSyncRuns?.((current) => [result, ...current].slice(0, 10));
          await loadMeta(folderId, validationAccount.id);
          await loadMessages(folderId, query, filter, validationAccount.id);
          return result;
        },
        onUpdate: (nextReport) => {
          if (providerValidationRunId.current === runId) {
            setProviderValidationReport(nextReport);
          }
        },
      });
      if (providerValidationRunId.current === runId) {
        setStatus(report.summary);
      }
      return report;
    } finally {
      if (providerValidationRunId.current === runId) {
        setProviderValidationRunning(false);
      }
    }
  }, [
    accountForm,
    filter,
    folderId,
    loadMessages,
    loadMeta,
    providerValidationRunning,
    query,
    setConnectionReport,
    setCredentialVerification,
    setImapMailboxes,
    setImapProbe,
    setStatus,
    setSyncRuns,
    updateProviderVerification,
  ]);

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
    providerValidationReport,
    providerValidationRunning,
    discoverImapFolders,
    runReadOnlyProviderValidation,
    mapImapMailbox,
    createAndMapImapMailbox,
    runSyncDryRun,
    syncImapHistoryPage,
  };
}
