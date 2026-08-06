import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
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

type ContactManagementOptions = {
  setStatus: Dispatch<SetStateAction<string>>;
  setNotificationPolicy: Dispatch<SetStateAction<NotificationPolicy>>;
};

export default function useContactManagement({
  setStatus,
  setNotificationPolicy,
}: ContactManagementOptions) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [contactEditName, setContactEditName] = useState('');
  const [contactEditAliases, setContactEditAliases] = useState('');
  const [contactForm, setContactForm] = useState<ContactCreateInput>(emptyContactForm);
  const [contactFormAliases, setContactFormAliases] = useState('');
  const [mergeSourceContactId, setMergeSourceContactId] = useState<number | null>(null);
  const [contactQuery, setContactQuery] = useState('');
  const [contactTransferBusy, setContactTransferBusy] = useState(false);
  const [confirmDeleteContact, setConfirmDeleteContact] = useState<Contact | null>(null);

  const filteredContacts = useMemo(() => {
    const term = contactQuery.trim().toLowerCase();
    const sortedContacts = [...contacts].sort((left, right) => {
      const byCount = right.message_count - left.message_count;
      if (byCount !== 0) return byCount;
      return right.last_seen_at.localeCompare(left.last_seen_at);
    });
    if (!term) return sortedContacts.slice(0, 6);
    return sortedContacts
      .filter((contact) =>
        [contact.name, contact.email, contact.aliases.join(' ')].join(' ').toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [contactQuery, contacts]);

  function startEditContact(contact: Contact) {
    setEditingContactId(contact.id);
    setContactEditName(contact.name);
    setContactEditAliases(contact.aliases.join(', '));
  }

  async function refreshManagedContacts() {
    const refreshed = await invoke<Contact[]>('list_contacts');
    setContacts(refreshed);
    return refreshed;
  }

  async function exportContactsVcard() {
    setContactTransferBusy(true);
    try {
      const summary = await invoke<ContactExportSummary | null>('export_contacts_vcard');
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
    const email = contactForm.email.trim().toLowerCase();
    if (!email) {
      setStatus('请输入联系人邮箱');
      return;
    }
    const created = await invoke<Contact>('create_contact', {
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
    const updated = await invoke<Contact>('update_contact', {
      contactId: contact.id,
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
    const updated = await invoke<Contact>('update_contact', {
      contactId: contact.id,
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
    await invoke('delete_contact', { contactId: contact.id });
    setContacts((current) => current.filter((item) => item.id !== contact.id));
    if (editingContactId === contact.id) {
      setEditingContactId(null);
    }
    if (mergeSourceContactId === contact.id) {
      setMergeSourceContactId(null);
    }
    setStatus(`联系人已删除：${contact.name || contact.email}`);
  }

  async function mergeManagedContact(target: Contact) {
    if (!mergeSourceContactId || mergeSourceContactId === target.id) {
      setStatus('请选择要合并进来的联系人');
      return;
    }
    const source = contacts.find((contact) => contact.id === mergeSourceContactId);
    const merged = await invoke<Contact>('merge_contacts', {
      targetContactId: target.id,
      sourceContactId: mergeSourceContactId,
    });
    setContacts((current) => [
      merged,
      ...current.filter((item) => item.id !== target.id && item.id !== mergeSourceContactId),
    ]);
    setMergeSourceContactId(null);
    setStatus(`已合并联系人：${source?.name || source?.email || '来源联系人'} → ${merged.name || merged.email}`);
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
    mergeSourceContactId,
    setMergeSourceContactId,
    contactQuery,
    setContactQuery,
    contactTransferBusy,
    filteredContacts,
    managedContacts: contacts,
    startEditContact,
    createManagedContact,
    saveContactOverride,
    toggleContactVip,
    deleteManagedContact,
    mergeManagedContact,
    exportContactsVcard,
    refreshManagedContacts,
    confirmDeleteContact,
    setConfirmDeleteContact,
  };
}
