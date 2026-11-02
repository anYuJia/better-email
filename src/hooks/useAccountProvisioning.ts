import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { emptyAccountCreateForm } from '../app/appConfig';
import {
  formatInvokeError,
  handleAccountDeleteFlow,
  maskEmailForLog,
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
  setStatus: Dispatch<SetStateAction<string>>;
  /** 凭据验证成功后立即回调（登录遮罩随即关闭，同步转入后台任务）。 */
  onAccountCreated?: (account: Account) => void;
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
  setStatus,
  onAccountCreated,
  loadMeta,
  loadMessages,
}: AccountProvisioningOptions) {
  const creatingRef = useRef<Promise<Account | void> | null>(null);
  const createNewAccount = useCallback((secret?: string, onProgress?: (stage: string) => void) => {
    if (creatingRef.current) return creatingRef.current;
    const trimmedSecret = secret?.trim() ?? '';
    if (!newAccountForm.email.trim() || !trimmedSecret) {
      return Promise.reject(new Error('请填写邮箱地址和登录凭据后再登录。'));
    }
    const run = async () => {
      let created: Account | null = null;
      let verified = false;
      try {
        onProgress?.('正在加密保存账号与凭据，并检查本机读回结果...');
        created = await invoke<Account>(IPC.CreateAccount, { input: newAccountForm, secret: trimmedSecret });
        onProgress?.('正在使用已保存的凭据验证服务器登录...');
        const verification = await invoke<CredentialVerificationReport>(IPC.VerifyAccountCredentials, {
          accountId: created.id,
        });
        if (!verification.authenticated || verification.account_email !== created.email) {
          throw new Error(verification.message || '已保存的账号凭据未通过登录验证。');
        }
        verified = true;
        setCredentialVerification(verification);
        setCredentialStatus({ account_email: created.email, exists: true, status: 'exists', message: '本机凭据已保存，服务器登录验证通过。' });
        setAccounts((current) => [...current.filter((account) => account.id !== created!.id), created!]);
        setAccountScope(created.id);
        setAccount(created);
        setAccountForm(created);
        setNewAccountForm(emptyAccountCreateForm);
        setFolderId(null);
        setMessages([]);
        setSelectedId(null);
        setAttachments([]);
        try {
          onAccountCreated?.(created);
          onProgress?.('登录验证通过，正在进入应用...');
        } catch {
          setStatus('登录验证已通过，初始界面刷新未完成，请刷新邮箱；无需重新创建账号。');
        }
        return created;
      } catch (error) {
        if (created && !verified) {
          try {
            await invoke<Account | null>(IPC.DeleteAccount, { accountId: created.id });
          } catch {
            throw new Error(`${formatInvokeError(error)}；本次账号回滚未完成。账号仍保留，请在“登录与安全”修复，不要重复创建。`);
          }
        }
        accountFlowWarn('create failed', { email: maskEmailForLog(newAccountForm.email), stage: created ? 'verify_saved' : 'atomic_save' });
        throw error;
      }
    };
    const pending = run().finally(() => { creatingRef.current = null; });
    creatingRef.current = pending;
    return pending;
  }, [
    newAccountForm, onAccountCreated, setAccount, setAccountForm, setAccountScope, setAccounts,
    setAttachments, setCredentialStatus, setCredentialVerification, setFolderId, setMessages,
    setNewAccountForm, setSelectedId, setStatus,
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
