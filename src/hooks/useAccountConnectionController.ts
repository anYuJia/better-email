import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { emptyAccountCreateForm } from '../app/appConfig';
import {
  runProviderValidation as executeProviderValidation,
  type ProviderValidationReport,
} from '../app/providerValidation';
import type {
  Account,
  AccountCreateInput,
  AccountScope,
  Attachment,
  ConnectionReport,
  CredentialStatus,
  CredentialVerificationReport,
  FilterMode,
  Folder,
  ImapMailboxState,
  ImapProbeReport,
  Message,
  ProviderVerificationRecord,
  SearchScope,
  SyncRun,
} from '../app/types';
import {
  incomingHostForProtocol,
  providerCompatibilityMatrix,
  type AccountProviderPreset,
} from '../providerCatalog';
import { invoke } from '../tauriBridge';

type LoadMetaResult = {
  folderId: number | null;
  folders: Folder[];
};

type UseAccountConnectionControllerOptions = {
  accountForm: Account | null;
  newAccountForm: AccountCreateInput;
  providerVerifications: Record<string, ProviderVerificationRecord>;
  diagnosticExport: string | null;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setAccountScope: Dispatch<SetStateAction<AccountScope>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setNewAccountForm: Dispatch<SetStateAction<AccountCreateInput>>;
  setFolderId: Dispatch<SetStateAction<number | null>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setProviderVerifications: Dispatch<SetStateAction<Record<string, ProviderVerificationRecord>>>;
  setConnectionReport: Dispatch<SetStateAction<ConnectionReport | null>>;
  setCredentialVerification: Dispatch<SetStateAction<CredentialVerificationReport | null>>;
  setCredentialStatus: Dispatch<SetStateAction<CredentialStatus | null>>;
  setImapProbe: Dispatch<SetStateAction<ImapProbeReport | null>>;
  setImapMailboxes: Dispatch<SetStateAction<ImapMailboxState[]>>;
  setSyncRuns: Dispatch<SetStateAction<SyncRun[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  loadMeta: (nextFolderId?: number | null, nextScope?: AccountScope) => Promise<LoadMetaResult>;
  loadMessages: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
    refreshId?: number,
    nextLimit?: number,
    nextSearchScope?: SearchScope,
  ) => Promise<Message[]>;
};

export function providerVerificationKey(providerName: string): string {
  const normalized = providerName.trim().toLowerCase();
  if (!normalized) return 'custom';
  return providerCompatibilityMatrix.find((provider) => provider.provider === normalized)?.id ?? normalized;
}

export function providerVerificationRecordFor(
  providerName: string,
  records: Record<string, ProviderVerificationRecord>,
): ProviderVerificationRecord {
  const key = providerVerificationKey(providerName);
  const normalized = providerName.trim().toLowerCase();
  const catalogEntry = providerCompatibilityMatrix.find(
    (provider) => provider.id === key || provider.provider === normalized,
  );
  return (
    records[key] ?? {
      provider_key: key,
      provider_label: catalogEntry?.label ?? (providerName.trim() || 'Custom'),
      status: 'untested',
      imap_ok: false,
      smtp_ok: false,
      oauth_ok: false,
      diagnostic_exported: false,
      checked_at: '',
      notes: '',
    }
  );
}

export function credentialVerificationPatch(
  report: CredentialVerificationReport,
  authType: string,
): Partial<ProviderVerificationRecord> {
  const imapOk = report.checks.some((check) => {
    const name = check.name.toLowerCase();
    return (name.includes('imap') || name.includes('pop3')) && check.authenticated;
  });
  const smtpOk = report.checks.some((check) => check.name === 'SMTP' && check.authenticated);
  return {
    status: report.authenticated ? 'passed' : imapOk || smtpOk ? 'partial' : 'failed',
    imap_ok: imapOk,
    smtp_ok: smtpOk,
    checked_at: report.checked_at,
    ...(authType === 'oauth2' ? { oauth_ok: report.authenticated } : {}),
  };
}

export default function useAccountConnectionController({
  accountForm,
  newAccountForm,
  providerVerifications,
  diagnosticExport,
  folderId,
  query,
  filter,
  setAccount,
  setAccounts,
  setAccountScope,
  setAccountForm,
  setNewAccountForm,
  setFolderId,
  setMessages,
  setSelectedId,
  setAttachments,
  setSettingsOpen,
  setProviderVerifications,
  setConnectionReport,
  setCredentialVerification,
  setCredentialStatus,
  setImapProbe,
  setImapMailboxes,
  setSyncRuns,
  setStatus,
  loadMeta,
  loadMessages,
}: UseAccountConnectionControllerOptions) {
  const [providerValidationReport, setProviderValidationReport] = useState<ProviderValidationReport | null>(null);
  const [providerValidationRunning, setProviderValidationRunning] = useState(false);
  const providerValidationRunId = useRef(0);
  const providerVerificationFor = useCallback(
    (providerName: string) => providerVerificationRecordFor(providerName, providerVerifications),
    [providerVerifications],
  );

  const updateProviderVerification = useCallback((
    providerName: string,
    patch: Partial<ProviderVerificationRecord>,
  ) => {
    const current = providerVerificationFor(providerName);
    setProviderVerifications((records) => ({
      ...records,
      [current.provider_key]: {
        ...current,
        ...patch,
        checked_at: patch.checked_at ?? current.checked_at,
      },
    }));
  }, [providerVerificationFor, setProviderVerifications]);

  const activeProviderVerification = useMemo(
    () => (accountForm ? providerVerificationFor(accountForm.provider) : null),
    [accountForm, providerVerificationFor],
  );

  const saveSettings = useCallback(async () => {
    if (!accountForm) return;
    const updated = await invoke<Account>('update_account_settings', {
      accountId: accountForm.id,
      input: accountForm,
    });
    setAccount(updated);
    setAccountForm(updated);
    setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSettingsOpen(false);
    setStatus('账号和同步设置已保存');
  }, [
    accountForm,
    setAccount,
    setAccountForm,
    setAccounts,
    setSettingsOpen,
    setStatus,
  ]);

  const createNewAccount = useCallback(async (secret?: string) => {
    if (!newAccountForm.email.trim()) {
      setStatus('请先填写新账号邮箱地址');
      return;
    }
    const created = await invoke<Account>('create_account', { input: newAccountForm });
    const trimmedSecret = secret?.trim() ?? '';
    if (trimmedSecret) {
      const credentialResult = await invoke<CredentialStatus>('store_account_secret', {
        input: { account_email: created.email, secret: trimmedSecret },
      });
      setCredentialStatus(credentialResult);
      setCredentialVerification(null);
    }
    setAccounts((current) => [...current, created]);
    setAccountScope(created.id);
    setAccount(created);
    setAccountForm(created);
    setNewAccountForm(emptyAccountCreateForm);
    setFolderId(null);
    setMessages([]);
    setSelectedId(null);
    setAttachments([]);
    const { folderId: nextFolderId } = await loadMeta(null, created.id);
    await loadMessages(nextFolderId, query, filter, created.id, undefined, undefined, 'all');
    setStatus(trimmedSecret ? `已创建账号并保存凭据：${created.email}` : `已创建账号：${created.email}`);
  }, [
    filter,
    loadMessages,
    loadMeta,
    newAccountForm,
    query,
    setAccount,
    setAccountForm,
    setAccountScope,
    setAccounts,
    setAttachments,
    setCredentialStatus,
    setCredentialVerification,
    setFolderId,
    setMessages,
    setNewAccountForm,
    setSelectedId,
    setStatus,
  ]);

  const removeCurrentAccount = useCallback(async () => {
    if (!accountForm) return;
    const removedAccount = accountForm;
    const nextAccount = await invoke<Account | null>('delete_account', { accountId: removedAccount.id });
    try {
      const credentialResult = await invoke<CredentialStatus>('delete_account_secret', {
        accountEmail: removedAccount.email,
      });
      setCredentialStatus(credentialResult);
    } catch {
      setCredentialStatus({
        account_email: removedAccount.email,
        exists: false,
        message: '账号已移除，但系统安全存储中的凭据需要手动检查。',
      });
    }
    setAccounts((current) => current.filter((item) => item.id !== removedAccount.id));
    setAccountScope(nextAccount?.id ?? 'all');
    setAccount(nextAccount);
    setAccountForm(nextAccount);
    setFolderId(null);
    setMessages([]);
    setSelectedId(null);
    setAttachments([]);
    if (nextAccount) {
      const { folderId: nextFolderId } = await loadMeta(null, nextAccount.id);
      await loadMessages(nextFolderId, query, filter, nextAccount.id);
      setSettingsOpen(false);
      setStatus(`已移除 ${removedAccount.email}，当前切换到 ${nextAccount.email}`);
      return;
    }
    await loadMeta(null, 'all');
    setSettingsOpen(true);
    setStatus(`已移除 ${removedAccount.email}，当前没有邮箱账号`);
  }, [
    accountForm,
    filter,
    loadMessages,
    loadMeta,
    query,
    setAccount,
    setAccountForm,
    setAccountScope,
    setAttachments,
    setCredentialStatus,
    setFolderId,
    setMessages,
    setSelectedId,
    setSettingsOpen,
    setStatus,
  ]);

  const setDefaultAccount = useCallback(async (accountId: number) => {
    const updated = await invoke<Account>('set_default_account', { accountId });
    setAccounts((current) => current
      .map((item) => ({ ...item, is_default: item.id === updated.id }))
      .sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.id - right.id));
    setAccount((current) => {
      if (!current) return current;
      return current.id === updated.id ? updated : { ...current, is_default: false };
    });
    setAccountForm((current) => {
      if (!current) return current;
      return current.id === updated.id ? updated : { ...current, is_default: false };
    });
    setStatus(`默认发件账号已设为：${updated.email}`);
  }, [setAccount, setAccountForm, setAccounts, setStatus]);

  const applyProviderPreset = useCallback((preset: AccountProviderPreset) => {
    setAccountForm((current) => (
      current
        ? {
            ...current,
            provider: preset.provider,
            imap_host: incomingHostForProtocol(preset, current.incoming_protocol),
            smtp_host: preset.smtp_host,
            auth_type: preset.auth_type,
          }
        : current
    ));
    setStatus(`${preset.label} 服务商预设已填入，可继续保存和测试连接`);
  }, [setAccountForm, setStatus]);

  const applyNewAccountPreset = useCallback((preset: AccountProviderPreset) => {
    setNewAccountForm((current) => ({
      ...current,
      provider: preset.provider,
      imap_host: incomingHostForProtocol(preset, current.incoming_protocol),
      smtp_host: preset.smtp_host,
      auth_type: preset.auth_type,
    }));
    setStatus(`${preset.label} 预设已填入新账号表单`);
  }, [setNewAccountForm, setStatus]);

  const saveProviderVerification = useCallback(() => {
    if (!accountForm) return;
    updateProviderVerification(accountForm.provider, {
      checked_at: new Date().toISOString(),
      diagnostic_exported: Boolean(diagnosticExport),
    });
    setStatus('服务商兼容性验证记录已保存到本地');
  }, [accountForm, diagnosticExport, setStatus, updateProviderVerification]);

  const testConnection = useCallback(async () => {
    const report = await invoke<ConnectionReport>('test_connection', { accountId: accountForm?.id });
    setConnectionReport(report);
    setStatus(
      report.ready_for_credentials
        ? '服务器连接成功；账号是否可登录仍需点击“验证登录”'
        : '服务器测试完成，请查看网络结果',
    );
    return report;
  }, [accountForm?.id, setConnectionReport, setStatus]);

  const verifyAccountCredentials = useCallback(async () => {
    const report = await invoke<CredentialVerificationReport>('verify_account_credentials', {
      accountId: accountForm?.id,
    });
    setCredentialVerification(report);
    if (accountForm && report.status !== 'credential_error') {
      updateProviderVerification(
        accountForm.provider,
        credentialVerificationPatch(report, accountForm.auth_type),
      );
    }
    setStatus(report.message);
    return report;
  }, [
    accountForm,
    setCredentialVerification,
    setStatus,
    updateProviderVerification,
  ]);

  const discoverImapFolders = useCallback(async () => {
    const report = await invoke<ImapProbeReport>('discover_imap_folders', { accountId: accountForm?.id });
    setImapProbe(report);
    const mailboxes = await invoke<ImapMailboxState[]>('list_imap_mailboxes');
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
      const report = await executeProviderValidation(validationAccount.email, {
        incomingProtocol: validationAccount.incoming_protocol,
        testConnection: async () => {
          const result = await invoke<ConnectionReport>('test_connection', {
            accountId: validationAccount.id,
          });
          setConnectionReport(result);
          return result;
        },
        verifyCredentials: async () => {
          const result = await invoke<CredentialVerificationReport>('verify_account_credentials', {
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
          const result = await invoke<ImapProbeReport>('discover_imap_folders', {
            accountId: validationAccount.id,
          });
          setImapProbe(result);
          const mailboxes = await invoke<ImapMailboxState[]>('list_imap_mailboxes');
          setImapMailboxes(mailboxes);
          return result;
        },
        syncHeaders: async () => {
          const result = await invoke<SyncRun>('sync_imap_headers', {
            accountId: validationAccount.id,
          });
          setSyncRuns((current) => [result, ...current].slice(0, 10));
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
    const mapped = await invoke<ImapMailboxState>('map_imap_mailbox', {
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
    const folder = await invoke<Folder>('create_custom_folder', {
      accountId: mailbox.account_id,
      name: suggestedName,
    });
    const mapped = await invoke<ImapMailboxState>('map_imap_mailbox', {
      mailboxId: mailbox.id,
      folderId: folder.id,
    });
    setImapMailboxes((current) => current.map((item) => (item.id === mapped.id ? mapped : item)));
    await loadMeta(folderId);
    setStatus(`已创建 ${folder.name} 并映射远端目录 ${mapped.remote_name}`);
  }, [folderId, loadMeta, setImapMailboxes, setStatus]);

  const runSyncDryRun = useCallback(async () => {
    const run = await invoke<SyncRun>('run_sync_dry_run', { accountId: accountForm?.id });
    setSyncRuns((current) => [run, ...current].slice(0, 10));
    await loadMeta(folderId);
    setStatus('同步演练已完成并记录');
    return run;
  }, [accountForm?.id, folderId, loadMeta, setStatus, setSyncRuns]);

  const syncImapHistoryPage = useCallback(async () => {
    const run = await invoke<SyncRun>('sync_imap_history', { accountId: accountForm?.id });
    setSyncRuns((current) => [run, ...current].slice(0, 10));
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
    activeProviderVerification,
    providerValidationReport,
    providerValidationRunning,
    updateProviderVerification,
    saveSettings,
    createNewAccount,
    removeCurrentAccount,
    setDefaultAccount,
    applyProviderPreset,
    applyNewAccountPreset,
    saveProviderVerification,
    testConnection,
    verifyAccountCredentials,
    discoverImapFolders,
    runReadOnlyProviderValidation,
    mapImapMailbox,
    createAndMapImapMailbox,
    runSyncDryRun,
    syncImapHistoryPage,
  };
}
