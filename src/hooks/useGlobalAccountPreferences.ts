import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { Account } from '../app/types';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';

type GlobalAccountPreferencesOptions = {
  accounts: Account[];
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

type GlobalAccountPreferencePatch = Pick<
  Account,
  'cross_account_risk_warning' | 'auto_download_attachments'
>;

function replaceUpdatedAccounts(current: Account[], updated: Account[]) {
  const updates = new Map(updated.map((account) => [account.id, account]));
  return current.map((account) => updates.get(account.id) ?? account);
}

export default function useGlobalAccountPreferences({
  accounts,
  setAccount,
  setAccountForm,
  setAccounts,
  setStatus,
}: GlobalAccountPreferencesOptions) {
  const [globalAccountPreferenceBusy, setGlobalAccountPreferenceBusy] = useState(false);

  const updateAllAccounts = useCallback(async (
    patch: Partial<GlobalAccountPreferencePatch>,
    successMessage: string,
  ) => {
    if (accounts.length === 0 || globalAccountPreferenceBusy) return;
    setGlobalAccountPreferenceBusy(true);
    try {
      const updated = await Promise.all(accounts.map((account) => invoke<Account>(
        IPC.UpdateAccountSettings,
        { accountId: account.id, input: { ...account, ...patch } },
      )));
      const updatedById = new Map(updated.map((account) => [account.id, account]));
      setAccounts((current) => replaceUpdatedAccounts(current, updated));
      setAccount((current) => current ? updatedById.get(current.id) ?? current : current);
      setAccountForm((current) => current ? { ...current, ...patch } : current);
      setStatus(successMessage);
    } catch (error) {
      setStatus(`全局偏好更新失败：${String(error)}`);
    } finally {
      setGlobalAccountPreferenceBusy(false);
    }
  }, [
    accounts,
    globalAccountPreferenceBusy,
    setAccount,
    setAccountForm,
    setAccounts,
    setStatus,
  ]);

  const onGlobalCrossAccountRiskWarningChange = useCallback((checked: boolean) => {
    void updateAllAccounts(
      { cross_account_risk_warning: checked },
      checked ? '已开启跨邮箱发送提醒' : '已关闭跨邮箱发送提醒',
    );
  }, [updateAllAccounts]);

  const onGlobalAutoDownloadAttachmentsChange = useCallback((checked: boolean) => {
    void updateAllAccounts(
      { auto_download_attachments: checked },
      checked ? '已为所有账号开启附件自动下载' : '已关闭附件自动下载',
    );
  }, [updateAllAccounts]);

  return {
    globalCrossAccountRiskWarning: accounts.length === 0
      || accounts.every((account) => account.cross_account_risk_warning !== false),
    globalAutoDownloadAttachments: accounts.length > 0
      && accounts.every((account) => account.auto_download_attachments),
    globalAccountPreferenceBusy,
    onGlobalCrossAccountRiskWarningChange,
    onGlobalAutoDownloadAttachmentsChange,
  };
}
