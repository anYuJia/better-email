import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  emptyContactForm,
  normalizeContactAliases,
} from '../app/appConfig';
import type {
  Contact,
  ContactCreateInput,
  ContactExportSummary,
} from '../app/types';
import type { NotificationPolicy } from '../mailUtils';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type ContactManagementOptions = {
  setStatus: Dispatch<SetStateAction<string>>;
  setNotificationPolicy: Dispatch<SetStateAction<NotificationPolicy>>;
  accountId?: number | null;
};

export default function useContactManagement({
  setStatus,
  setNotificationPolicy,
  accountId,
}: ContactManagementOptions) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [contactEditName, setContactEditName] = useState('');
  const [contactEditAliases, setContactEditAliases] = useState('');
  const [contactForm, setContactForm] = useState<ContactCreateInput>(emptyContactForm);
  const [contactFormAliases, setContactFormAliases] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [contactTransferBusy, setContactTransferBusy] = useState(false);
  const [confirmDeleteContact, setConfirmDeleteContact] = useState<Contact | null>(null);

  // Metadata refreshes are asynchronous. Keep the previous account's rows out
  // of every consumer during the gap between a scope change and its response.
  const visibleContacts = useMemo(() => (
    typeof accountId === 'number'
      ? contacts.filter((contact) => contact.account_id === accountId)
      : contacts
  ), [accountId, contacts]);

  const filteredContacts = useMemo(() => {
    const term = contactQuery.trim().toLowerCase();
    const sortedContacts = [...visibleContacts].sort((left, right) => {
      const byCount = right.message_count - left.message_count;
      if (byCount !== 0) return byCount;
      return right.last_seen_at.localeCompare(left.last_seen_at);
    });
    if (!term) return sortedContacts;
    return sortedContacts
      .filter((contact) =>
        [contact.name, contact.email, contact.aliases.join(' ')].join(' ').toLowerCase().includes(term),
      );
  }, [contactQuery, visibleContacts]);

  function startEditContact(contact: Contact) {
    setEditingContactId(contact.id);
    setContactEditName(contact.name);
    setContactEditAliases(contact.aliases.join(', '));
  }

  const refreshManagedContacts = useCallback(async () => {
    const refreshed = await invoke<Contact[]>(IPC.ListContacts, { accountId });
    setContacts(refreshed);
    return refreshed;
  }, [accountId]);

  async function exportContactsVcard() {
    setContactTransferBusy(true);
    try {
      const summary = await invoke<ContactExportSummary | null>(IPC.ExportContactsVcard, { accountId });
      if (!summary) {
        setStatus('已取消联系人 vCard 导出');
        return;
      }
      setStatus(`已导出 ${summary.contacts} 位联系人：${summary.path}`);
    } finally {
      setContactTransferBusy(false);
    }
  }

  async function createManagedContact() {
    if (typeof accountId !== 'number') {
      setStatus('请先选择具体邮箱账号，再添加联系人');
      return;
    }
    const email = contactForm.email.trim().toLowerCase();
    if (!email) {
      setStatus('请输入联系人邮箱');
      return;
    }
    const created = await invoke<Contact>(IPC.CreateContact, {
      accountId,
      input: {
        ...contactForm,
        email,
        aliases: normalizeContactAliases(contactFormAliases).filter((alias) => alias !== email),
      },
    });
    setContacts((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    setContactForm(emptyContactForm);
    setContactFormAliases('');
    setStatus(`联系人已新增：${created.name || created.email}`);
  }

  async function saveContactOverride(contact: Contact) {
    const aliases = normalizeContactAliases(contactEditAliases)
      .filter((alias) => alias !== contact.email.trim().toLowerCase());
    const updated = await invoke<Contact>(IPC.UpdateContact, {
      contactId: contact.id,
      accountId: contact.account_id,
      input: {
        name: contactEditName.trim() || contact.name,
        aliases,
        vip: contact.vip,
      },
    });
    setContacts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setEditingContactId(null);
    setStatus(`联系人已更新：${updated.name}`);
  }

  async function toggleContactVip(contact: Contact) {
    const nextVip = !contact.vip;
    const aliases = contact.aliases ?? [];
    const updated = await invoke<Contact>(IPC.UpdateContact, {
      contactId: contact.id,
      accountId: contact.account_id,
      input: {
        name: contact.name,
        aliases,
        vip: nextVip,
      },
    });
    setContacts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setNotificationPolicy((current) => {
      const vipSenders = normalizeContactAliases(current.vipSenders);
      const contactEmails = [contact.email, ...aliases]
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const nextSenders = nextVip
        ? [...new Set([...vipSenders, ...contactEmails])]
        : vipSenders.filter((sender) => !contactEmails.includes(sender));
      return { ...current, vipSenders: nextSenders.join('\n') };
    });
    setStatus(nextVip
      ? `已设为 VIP：${updated.name || updated.email}`
      : `已取消 VIP：${updated.name || updated.email}`);
  }

  async function deleteManagedContact(contact: Contact) {
    await invoke(IPC.DeleteContact, { contactId: contact.id, accountId: contact.account_id });
    setContacts((current) => current.filter((item) => item.id !== contact.id));
    if (editingContactId === contact.id) {
      setEditingContactId(null);
    }
    setStatus(`联系人已删除：${contact.name || contact.email}`);
  }

  return {
    contacts,
    setContacts,
    editingContactId,
    setEditingContactId,
    contactEditName,
    setContactEditName,
    contactEditAliases,
    setContactEditAliases,
    contactForm,
    setContactForm,
    contactFormAliases,
    setContactFormAliases,
    contactQuery,
    setContactQuery,
    contactTransferBusy,
    filteredContacts,
    managedContacts: visibleContacts,
    startEditContact,
    createManagedContact,
    saveContactOverride,
    toggleContactVip,
    deleteManagedContact,
    exportContactsVcard,
    refreshManagedContacts,
    confirmDeleteContact,
    setConfirmDeleteContact,
  };
}
