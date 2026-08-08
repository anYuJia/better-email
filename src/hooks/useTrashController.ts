import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Account, AccountScope, TrashActionReport } from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

export type ConfirmEmptyTrashState = {
  accountId: number;
  accountScope: AccountScope;
  accountName: string;
};

type TrashControllerOptions = {
  accounts: Account[];
  accountScope: AccountScope;
  setStatus: Dispatch<SetStateAction<string>>;
  refreshAll: () => Promise<void>;
};

export default function useTrashController({
  accounts,
  accountScope,
  setStatus,
  refreshAll,
}: TrashControllerOptions) {
  const [confirmEmptyTrashState, setConfirmEmptyTrashState] = useState<ConfirmEmptyTrashState | null>(null);

  async function emptyCurrentTrashConfirmed(targetAccountId: number) {
    const report = await invoke<TrashActionReport>(IPC.EmptyTrash, { accountId: targetAccountId });
    await refreshAll();
    setStatus(report.message);
  }

  function emptyCurrentTrash() {
    const actId = accountScope === 'all' ? 0 : accountScope;
    const act = accounts.find((a) => a.id === actId);
    setConfirmEmptyTrashState({
      accountId: actId,
      accountScope,
      accountName: act ? `${act.display_name} <${act.email}>` : '当前账号',
    });
  }

  return {
    confirmEmptyTrashState,
    setConfirmEmptyTrashState,
    emptyCurrentTrash,
    emptyCurrentTrashConfirmed,
  };
}
