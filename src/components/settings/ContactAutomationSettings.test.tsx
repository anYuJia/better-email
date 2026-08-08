import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Contact, ContactCreateInput } from '../../app/types';
import ContactAutomationSettings from './ContactAutomationSettings';

const contactForm: ContactCreateInput = {
  name: '',
  email: '',
  aliases: [],
  vip: false,
};

const contact: Contact = {
  id: 1,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  aliases: ['ada@work.example'],
  vip: false,
  message_count: 3,
  last_seen_at: '2026-08-08T00:00:00Z',
};

function renderSettings(editingContactId: number | null = null) {
  return render(
    <ContactAutomationSettings
      contactForm={contactForm}
      contactFormAliases=""
      contacts={[contact]}
      filteredContacts={[contact]}
      contactQuery=""
      editingContactId={editingContactId}
      editName={contact.name}
      editAliases={contact.aliases.join(', ')}
      mergeSourceContactId={null}
      transferBusy={false}
      onContactFormChange={() => undefined}
      onContactFormAliasesChange={() => undefined}
      onContactQueryChange={() => undefined}
      onCreateContact={async () => undefined}
      onEditNameChange={() => undefined}
      onEditAliasesChange={() => undefined}
      onSaveContactOverride={() => undefined}
      onCancelEdit={() => undefined}
      onComposeToContact={() => undefined}
      onStartEditContact={() => undefined}
      onToggleContactVip={() => undefined}
      onMergeContact={() => undefined}
      onDeleteContact={() => undefined}
      onMergeSourceChange={() => undefined}
      onExportContacts={() => undefined}
      onRefreshContacts={async () => [contact]}
      onStatus={() => undefined}
    />,
  );
}

describe('ContactAutomationSettings', () => {
  afterEach(() => {
    cleanup();
  });

  it('groups contact creation, search, and merge controls into their respective workflows', () => {
    renderSettings();

    expect(screen.getByText('添加联系人')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: '联系人名称' })).not.toBeNull();
    expect(screen.getByRole('textbox', { name: /别名邮箱/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: '合并来源' })).not.toBeNull();
    expect(screen.getByText('选择来源后，再点目标联系人的合并按钮。')).not.toBeNull();
  });

  it('keeps inline editing labeled and exposes stable alias input', () => {
    renderSettings(contact.id);

    expect(screen.getAllByText('联系人名称')).toHaveLength(2);
    expect(screen.getAllByText('别名邮箱')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '保存' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '取消' })).not.toBeNull();
  });

  it('shows an inline error when a contact cannot be created', () => {
    const createContact = async () => undefined;
    render(
      <ContactAutomationSettings
        contactForm={{ ...contactForm, email: 'invalid' }}
        contactFormAliases=""
        contacts={[]}
        filteredContacts={[]}
        contactQuery=""
        editingContactId={null}
        editName=""
        editAliases=""
        mergeSourceContactId={null}
        transferBusy={false}
        onContactFormChange={() => undefined}
        onContactFormAliasesChange={() => undefined}
        onContactQueryChange={() => undefined}
        onCreateContact={createContact}
        onEditNameChange={() => undefined}
        onEditAliasesChange={() => undefined}
        onSaveContactOverride={() => undefined}
        onCancelEdit={() => undefined}
        onComposeToContact={() => undefined}
        onStartEditContact={() => undefined}
        onToggleContactVip={() => undefined}
        onMergeContact={() => undefined}
        onDeleteContact={() => undefined}
        onMergeSourceChange={() => undefined}
        onExportContacts={() => undefined}
        onRefreshContacts={async () => []}
        onStatus={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '新增联系人' }));
    expect(screen.getByRole('alert').textContent).toContain('有效的联系人邮箱');
  });
});
