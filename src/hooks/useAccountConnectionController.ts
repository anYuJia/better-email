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
import { flowInfo, flowWarn } from '../app/logger';
import {
  incomingHostForProtocol,
  providerCompatibilityMatrix,
  type AccountProviderPreset,
} from '../providerCatalog';
import { invoke } from '../tauriBridge';

function maskEmailForLog(value: string) {
  const email = value.trim();
  const [local, domain] = email.split('@');
  if (!local || !domain) return email ? '***' : '';
  return `${local[0] ?? '*'}***@${domain}`;
}

export interface DeleteFlowResult {
  allowed: boolean;
  credentialStatus: {
    account_email: string;
    exists: boolean;
    status: 'deleted' | 'not_found' | 'failed' | 'invalid_input' | 'exists';
    message: string;
  };
}

export function handleAccountDeleteFlow(
  email: string,
  deleteSecret: boolean,
  backendResult: { status: 'deleted' | 'not_found' | 'failed' | 'invalid_input'; message?: string } | null
): DeleteFlowResult {
  if (!deleteSecret) {
    return {
      allowed: true,
      credentialStatus: {
        account_email: email,
        exists: true,
        status: 'exists',
        message: '账号已成功移除；本地凭据已保留。'
      }
    };
  }

  if (!backendResult) {
    return {
      allowed: false,
      credentialStatus: {
        account_email: email,
        exists: true,
        status: 'failed',
        message: '本地凭据删除失败：未收到有效的后台响应'
      }
    };
  }

  if (backendResult.status === 'deleted') {
    return {
      allowed: true,
      credentialStatus: {
        account_email: email,
        exists: false,
        status: 'deleted',
        message: backendResult.message || '账号及本地凭据已成功移除。'
      }
    };
  }

  if (backendResult.status === 'not_found') {
    return {
      allowed: true,
      credentialStatus: {
        account_email: email,
        exists: false,
        status: 'not_found',
        message: backendResult.message || '账号已移除；本地数据库未找到对应凭据。'
      }
    };
  }

  if (backendResult.status === 'invalid_input') {
    return {
      allowed: false,
      credentialStatus: {
        account_email: email,
        exists: true,
        status: 'invalid_input',
        message: backendResult.message || '输入无效，操作被阻止。'
      }
    };
  }

  return {
    allowed: false,
    credentialStatus: {
      account_email: email,
      exists: true,
      status: 'failed',
      message: backendResult.message || '本地凭据删除失败，操作被阻止。'
    }
  };
}

function accountFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('account-flow', event, details);
}

function accountFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('account-flow', event, details);
}

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

export function shouldRunInitialMailboxSync(
  incomingProtocol: string,
  hasSecret: boolean,
  authenticated: boolean,
): boolean {
  if (!hasSecret || !authenticated) return false;
  return ['imap', 'pop3'].includes(incomingProtocol.trim().toLowerCase());
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

  const createNewAccount = useCallback(async (secret?: string, onProgress?: (stage: string) => void) => {
    if (!newAccountForm.email.trim()) {
      setStatus('请先填写新账号邮箱地址');
      accountFlowWarn('create skipped: missing email');
      return;
    }
    const trimmedSecret = secret?.trim() ?? '';
    accountFlowLog('create start', {
      email: maskEmailForLog(newAccountForm.email),
      provider: newAccountForm.provider,
      incomingProtocol: newAccountForm.incoming_protocol,
      hasSecret: Boolean(trimmedSecret),
    });
    try {
      onProgress?.('正在创建本地邮箱账号...');
      await new Promise((resolve) => setTimeout(resolve, 600));
      const created = await invoke<Account>('create_account', { input: newAccountForm });
      accountFlowLog('create account stored', {
        accountId: created.id,
        email: maskEmailForLog(created.email),
        isDefault: created.is_default,
      });
      let verification: CredentialVerificationReport | null = null;
      if (trimmedSecret) {
        onProgress?.('正在保存本机本地凭据...');
        await new Promise((resolve) => setTimeout(resolve, 600));
        const credentialResult = await invoke<CredentialStatus>('store_account_secret', {
          input: { account_email: created.email, secret: trimmedSecret },
        });
        setCredentialStatus(credentialResult);
        setCredentialVerification(null);
        accountFlowLog('credential stored', {
          email: maskEmailForLog(created.email),
          exists: credentialResult.exists,
          message: credentialResult.message,
        });
        if (!credentialResult.exists) {
          accountFlowWarn('credential store failed: rolling back account', {
            accountId: created.id,
            email: maskEmailForLog(created.email),
            message: credentialResult.message,
          });
          try {
            await invoke<Account | null>('delete_account', { accountId: created.id });
          } catch (rollbackError) {
            accountFlowWarn('credential rollback failed', {
              accountId: created.id,
              email: maskEmailForLog(created.email),
              error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            });
          }
          throw new Error(credentialResult.message);
        }
        onProgress?.('正在连接服务器验证登录凭据...');
        await new Promise((resolve) => setTimeout(resolve, 600));
        verification = await invoke<CredentialVerificationReport>('verify_account_credentials_with_secret', {
          input: {
            account_id: created.id,
            secret: trimmedSecret,
          },
        });
        setCredentialVerification(verification);
        accountFlowLog('credential verified after create', {
          email: maskEmailForLog(created.email),
          status: verification.status,
          authenticated: verification.authenticated,
        });
        if (!verification.authenticated) {
          accountFlowWarn('credential verification failed: rolling back account', {
            accountId: created.id,
            email: maskEmailForLog(created.email),
            status: verification.status,
            message: verification.message,
          });
          try {
            await invoke<Account | null>('delete_account', { accountId: created.id });
          } catch (rollbackError) {
            accountFlowWarn('verification rollback failed', {
              accountId: created.id,
              email: maskEmailForLog(created.email),
              error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            });
          }
          throw new Error(verification.message || '账号登录验证失败，请检查授权码和服务器配置。');
        }
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
      if (shouldRunInitialMailboxSync(created.incoming_protocol, Boolean(trimmedSecret), Boolean(verification?.authenticated))) {
        accountFlowLog('initial mailbox sync start', {
          accountId: created.id,
          email: maskEmailForLog(created.email),
          protocol: created.incoming_protocol,
        });
        try {
          onProgress?.('已成功登录！正在同步服务器邮件列表...');
          await new Promise((resolve) => setTimeout(resolve, 600));
          const syncRun = await invoke<SyncRun>('sync_imap_headers', {
            accountId: created.id,
          });
          setSyncRuns((current) => [syncRun, ...current].slice(0, 10));
          accountFlowLog('initial mailbox sync done', {
            accountId: created.id,
            status: syncRun.status,
            scannedFolders: syncRun.scanned_folders,
            importedMessages: syncRun.imported_messages,
          });
        } catch (syncError) {
          accountFlowWarn('initial mailbox sync failed', {
            accountId: created.id,
            email: maskEmailForLog(created.email),
            error: syncError instanceof Error ? syncError.message : String(syncError),
          });
        }
      }
      onProgress?.('已完成邮件同步，正在加载界面数据...');
      await new Promise((resolve) => setTimeout(resolve, 600));
      const { folderId: nextFolderId, folders: nextFolders } = await loadMeta(null, created.id);
      accountFlowLog('metadata loaded after create', {
        accountId: created.id,
        folderId: nextFolderId,
        folderCount: nextFolders.length,
      });
      await loadMessages(nextFolderId, query, filter, created.id, undefined, undefined, 'account');
      accountFlowLog('messages loaded after create', {
        accountId: created.id,
        folderId: nextFolderId,
      });
      setStatus(trimmedSecret ? `已创建并同步账号：${created.email}` : `已创建账号：${created.email}`);
    } catch (error) {
      accountFlowWarn('create failed', {
        email: maskEmailForLog(newAccountForm.email),
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await loadMeta(null);
      } catch (metaError) {
        accountFlowWarn('metadata reload on failure failed', {
          error: metaError instanceof Error ? metaError.message : String(metaError),
        });
      }
      throw error;
    }
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

  const removeCurrentAccount = useCallback(async (deleteSecret: boolean) => {
    if (!accountForm) return;
    const removedAccount = accountForm;
    accountFlowLog('remove start', {
      accountId: removedAccount.id,
      email: maskEmailForLog(removedAccount.email),
      deleteSecret,
    });

    let backendResult: CredentialStatus | null = null;
    if (deleteSecret) {
      try {
        backendResult = await invoke<CredentialStatus>('delete_account_secret', { accountEmail: removedAccount.email });
      } catch (e) {
        const errMsg = String(e);
        accountFlowWarn('failed to delete credential during account removal', {
          email: maskEmailForLog(removedAccount.email),
          error: errMsg,
        });
        const errorResult = handleAccountDeleteFlow(removedAccount.email, deleteSecret, { status: 'failed', message: errMsg });
        setCredentialStatus(errorResult.credentialStatus);
        setStatus(`凭据删除失败：${errMsg}`);
        throw e; // Block deletion
      }
    }

    const flowResult = handleAccountDeleteFlow(
      removedAccount.email,
      deleteSecret,
      backendResult
        ? {
            status: backendResult.status as 'deleted' | 'not_found' | 'failed' | 'invalid_input',
            message: backendResult.message,
          }
        : null
    );
    if (!flowResult.allowed) {
      setCredentialStatus(flowResult.credentialStatus);
      setStatus(flowResult.credentialStatus.message);
      throw new Error(flowResult.credentialStatus.message);
    }

    // Perform account database removal
    let nextAccount: Account | null = null;
    try {
      nextAccount = await invoke<Account | null>('delete_account', { accountId: removedAccount.id });
    } catch (e) {
      const errMsg = String(e);
      accountFlowWarn('failed to delete account record from db', {
        accountId: removedAccount.id,
        error: errMsg,
      });
      setStatus(`账号删除失败：${errMsg}`);
      throw e; // Do NOT swallow database deletion exceptions
    }
    
    accountFlowLog('remove account deleted', {
      removedAccountId: removedAccount.id,
      nextAccountId: nextAccount?.id ?? null,
    });
    setCredentialStatus(flowResult.credentialStatus);
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
      accountFlowLog('metadata loaded after remove', {
        nextAccountId: nextAccount.id,
        folderId: nextFolderId,
      });
      await loadMessages(nextFolderId, query, filter, nextAccount.id, undefined, undefined, 'account');
      setSettingsOpen(false);
      setStatus(`已移除 ${removedAccount.email}，当前切换到 ${nextAccount.email}`);
      return;
    }
    await loadMeta(null, 'all');
    accountFlowLog('all accounts removed');
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

  const syncImapHistoryPage = useCallback(async (targetAccountId?: number | null) => {
    const run = await invoke<SyncRun>('sync_imap_history', { accountId: targetAccountId ?? accountForm?.id });
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
