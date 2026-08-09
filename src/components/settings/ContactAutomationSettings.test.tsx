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

function renderSettings(editingContactId: number | null = null, allContacts: Contact[] = [contact]) {
  return render(
    <ContactAutomationSettings
      contactForm={contactForm}
      contactFormAliases=""
      contacts={allContacts}
      filteredContacts={allContacts}
      contactQuery=""
      editingContactId={editingContactId}
      editName={contact.name}
      editAliases={contact.aliases.join(', ')}
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
      onDeleteContact={() => undefined}
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

  it('keeps the address book compact and opens creation in a dialog', () => {
    renderSettings();

    expect(screen.getByRole('button', { name: '添加联系人' })).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: '联系人名称' })).toBeNull();
    expect(screen.queryByText('合并联系人')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '添加联系人' }));
    expect(screen.getByRole('dialog', { name: '添加联系人' })).not.toBeNull();
    expect(screen.getByRole('textbox', { name: '联系人名称' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '确认添加' })).not.toBeNull();
  });

  it('opens details from a row and editing in its own dialog', () => {
    const startEdit = () => undefined;
    render(
      <ContactAutomationSettings
        contactForm={contactForm} contactFormAliases="" contacts={[contact]} filteredContacts={[contact]} contactQuery=""
        editingContactId={contact.id} editName={contact.name} editAliases={contact.aliases.join(', ')} transferBusy={false}
        onContactFormChange={() => undefined} onContactFormAliasesChange={() => undefined} onContactQueryChange={() => undefined} onCreateContact={async () => undefined}
        onEditNameChange={() => undefined} onEditAliasesChange={() => undefined} onSaveContactOverride={() => undefined} onCancelEdit={() => undefined}
        onComposeToContact={() => undefined} onStartEditContact={startEdit} onToggleContactVip={() => undefined} onDeleteContact={() => undefined}
        onExportContacts={() => undefined} onRefreshContacts={async () => [contact]} onStatus={() => undefined}
      />,
    );

    fireEvent.click(screen.getByText('Ada Lovelace'));
    expect(screen.getByRole('dialog', { name: 'Ada Lovelace' })).not.toBeNull();
    expect(screen.getByText('ada@work.example')).not.toBeNull();
    expect(screen.queryByText('合并联系人')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByRole('dialog', { name: '编辑联系人' })).not.toBeNull();
    expect(screen.getByRole('textbox', { name: '联系人名称' })).not.toBeNull();
    expect(screen.getByRole('textbox', { name: /别名邮箱/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: '确认保存' })).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
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
        onDeleteContact={() => undefined}
        onExportContacts={() => undefined}
        onRefreshContacts={async () => []}
        onStatus={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加联系人' }));
    fireEvent.click(screen.getByRole('button', { name: '确认添加' }));
    expect(screen.getByRole('alert').textContent).toContain('有效的联系人邮箱');
  });

  it('paginates a long contact list', () => {
    const contacts = Array.from({ length: 9 }, (_, index) => ({ ...contact, id: index + 1, name: `Contact ${index + 1}`, email: `contact${index + 1}@example.com` }));
    renderSettings(null, contacts);
    expect(screen.getByText('Contact 1')).not.toBeNull();
    expect(screen.queryByText('Contact 9')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('Contact 9')).not.toBeNull();
  });
});
