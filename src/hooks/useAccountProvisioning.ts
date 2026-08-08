import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { emptyAccountCreateForm } from '../app/appConfig';
import {
  formatInvokeError,
  handleAccountDeleteFlow,
  maskEmailForLog,
  shouldRunInitialMailboxSync,
} from '../app/accountConnectionFlows';
import type {
  Account,
  AccountCreateInput,
  AccountScope,
  Attachment,
  CredentialStatus,
  CredentialVerificationReport,
  FilterMode,
  Folder,
  MessageSummary,
  SearchScope,
  SyncRun,
} from '../app/types';
import { flowInfo, flowWarn } from '../app/logger';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type AccountProvisioningOptions = {
  accounts: Account[];
  accountForm: Account | null;
  newAccountForm: AccountCreateInput;
  query: string;
  filter: FilterMode;
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setAccountScope: Dispatch<SetStateAction<AccountScope>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setNewAccountForm: Dispatch<SetStateAction<AccountCreateInput>>;
  setFolderId: Dispatch<SetStateAction<number | null>>;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setCredentialStatus: Dispatch<SetStateAction<CredentialStatus | null>>;
  setCredentialVerification: Dispatch<SetStateAction<CredentialVerificationReport | null>>;
  setSyncRuns?: Dispatch<SetStateAction<SyncRun[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  loadMeta: (
    nextFolderId?: number | null,
    nextScope?: AccountScope,
  ) => Promise<{ folderId: number | null; folders: { id: number }[] }>;
  loadMessages: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
    refreshId?: number,
    nextLimit?: number,
    nextSearchScope?: SearchScope,
  ) => Promise<MessageSummary[]>;
};

function accountFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('account-flow', event, details);
}

function accountFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('account-flow', event, details);
}

export default function useAccountProvisioning({
  accountForm,
  newAccountForm,
  query,
  filter,
  setAccount,
  setAccounts,
  setAccountScope,
  setAccountForm,
  setNewAccountForm,
  setFolderId,
  setFolders,
  setMessages,
  setSelectedId,
  setAttachments,
  setSettingsOpen,
  setCredentialStatus,
  setCredentialVerification,
  setSyncRuns,
  setStatus,
  loadMeta,
  loadMessages,
}: AccountProvisioningOptions) {
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
      const created = await invoke<Account>(IPC.CreateAccount, { input: newAccountForm });
      accountFlowLog('create account stored', {
        accountId: created.id,
        email: maskEmailForLog(created.email),
        isDefault: created.is_default,
      });
      let verification: CredentialVerificationReport | null = null;
      if (trimmedSecret) {
        onProgress?.('正在保存本机本地凭据...');
        await new Promise((resolve) => setTimeout(resolve, 600));
        const credentialResult = await invoke<CredentialStatus>(IPC.StoreAccountSecret, {
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
            await invoke<Account | null>(IPC.DeleteAccount, { accountId: created.id });
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
        verification = await invoke<CredentialVerificationReport>(IPC.VerifyAccountCredentialsWithSecret, {
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
            await invoke<Account | null>(IPC.DeleteAccount, { accountId: created.id });
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
          const syncRun = await invoke<SyncRun>(IPC.SyncImapHeaders, {
            accountId: created.id,
          });
          setSyncRuns?.((current) => [syncRun, ...current].slice(0, 10));
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
      try {
        const { folderId: nextFolderId, folders: nextFolders } = await loadMeta(null, created.id);
        accountFlowLog('metadata loaded after create', {
          accountId: created.id,
          folderId: nextFolderId,
          folderCount: nextFolders.length,
        });
        await loadMessages(nextFolderId, '', 'all', created.id, undefined, undefined, 'account');
        setStatus(`已创建邮箱账号：${created.email}${trimmedSecret ? '，并完成登录验证' : ''}`);
      } catch (initialLoadError) {
        const message = formatInvokeError(initialLoadError);
        accountFlowWarn('initial mailbox data load failed after create', {
          accountId: created.id,
          email: maskEmailForLog(created.email),
          error: message,
        });
        setStatus(`邮箱账号已创建${trimmedSecret ? '并完成登录验证' : ''}，但初始数据加载失败：${message}`);
      }
      return created;
    } catch (error) {
      accountFlowWarn('create failed', {
        email: maskEmailForLog(newAccountForm.email),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [
    newAccountForm,
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
    setSyncRuns,
    loadMeta,
    loadMessages,
  ]);

  const removeCurrentAccount = useCallback(async (deleteSecret: boolean) => {
    if (!accountForm) return;
    const removedAccount = accountForm;
    accountFlowLog('remove start', {
      accountId: removedAccount.id,
      email: maskEmailForLog(removedAccount.email),
      deleteSecret,
    });

    let nextAccount: Account | null = null;
    try {
      nextAccount = await invoke<Account | null>(IPC.RemoveAccount, {
        accountId: removedAccount.id,
        deleteCredentials: deleteSecret,
      });
    } catch (e) {
      const errMsg = formatInvokeError(e);
      accountFlowWarn('failed to remove account atomically', {
        accountId: removedAccount.id,
        email: maskEmailForLog(removedAccount.email),
        error: errMsg,
      });
      setStatus(`账号移除失败：${errMsg}`);
      throw e; // Account and credentials remain untouched: removal is atomic on the backend
    }

    const flowResult = handleAccountDeleteFlow(
      removedAccount.email,
      deleteSecret,
      deleteSecret ? { status: 'deleted', message: '账号及本地凭据已成功移除。' } : null,
    );

    accountFlowLog('remove account deleted', {
      removedAccountId: removedAccount.id,
      nextAccountId: nextAccount?.id ?? null,
      credentialsDeleted: deleteSecret,
    });
    setCredentialStatus(flowResult.credentialStatus);
    setAccounts((current) => current.filter((item) => item.id !== removedAccount.id));
    setAccountScope(nextAccount?.id ?? 'all');
    setAccount(nextAccount);
    setAccountForm(nextAccount);
    setFolderId(null);
    setFolders([]);
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
    setFolders,
    setMessages,
    setSelectedId,
    setSettingsOpen,
    setStatus,
  ]);

  const setDefaultAccount = useCallback(async (accountId: number) => {
    const updated = await invoke<Account>(IPC.SetDefaultAccount, { accountId });
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

  return {
    createNewAccount,
    removeCurrentAccount,
    setDefaultAccount,
  };
}
