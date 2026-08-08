import { useState, type Dispatch, type SetStateAction } from 'react';
import { emptyIdentityForm } from '../app/appConfig';
import type { Account, MailIdentity, MailIdentityInput } from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type IdentityManagementOptions = {
  accountForm: Account | null;
  identities: MailIdentity[];
  setIdentities: Dispatch<SetStateAction<MailIdentity[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useIdentityManagement({
  accountForm,
  setIdentities,
  setStatus,
}: IdentityManagementOptions) {
  const [identityForm, setIdentityForm] = useState<MailIdentityInput>(emptyIdentityForm);
  const [confirmDeleteIdentity, setConfirmDeleteIdentity] = useState<MailIdentity | null>(null);

  async function saveIdentity() {
    if (!accountForm) return;
    const saved = await invoke<MailIdentity>(IPC.UpsertIdentity, {
      input: { ...identityForm, account_id: accountForm.id },
    });
    setIdentities((current) => {
      const scoped = current.filter((identity) => identity.account_id !== saved.account_id || identity.id !== saved.id);
      const updated = saved.is_default
        ? scoped.map((identity) =>
            identity.account_id === saved.account_id ? { ...identity, is_default: false } : identity,
          )
        : scoped;
      return [...updated, saved].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.id - b.id);
    });
    setIdentityForm(emptyIdentityForm);
    setStatus(`发件身份已保存：${saved.name} <${saved.email}>`);
  }

  function editIdentity(identity: MailIdentity) {
    setIdentityForm({
      id: identity.id,
      account_id: identity.account_id,
      name: identity.name,
      email: identity.email,
      reply_to: identity.reply_to,
      signature: identity.signature,
      is_default: identity.is_default,
    });
    setStatus(`正在编辑发件身份：${identity.email}`);
  }

  async function deleteIdentityConfirmed(identity: MailIdentity) {
    await invoke(IPC.DeleteIdentity, { identityId: identity.id });
    setIdentities((current) => current.filter((item) => item.id !== identity.id));
    setStatus(`发件身份已删除：${identity.email}`);
  }

  function deleteIdentity(identity: MailIdentity) {
    setConfirmDeleteIdentity(identity);
  }

  return {
    identityForm,
    setIdentityForm,
    confirmDeleteIdentity,
    setConfirmDeleteIdentity,
    saveIdentity,
    editIdentity,
    deleteIdentityConfirmed,
    deleteIdentity,
  };
}
