import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

type RenderOptions = {
  editingContactId?: number | null;
  allContacts?: Contact[];
  editName?: string;
  editAliases?: string;
  onSaveContactOverride?: (contact: Contact) => void | Promise<void>;
  onComposeToContact?: (contact: Contact) => void;
  onToggleContactVip?: (contact: Contact) => void;
  onDeleteContact?: (contact: Contact) => void;
  onStartEditContact?: (contact: Contact) => void;
};

function renderSettings(options: RenderOptions = {}) {
  const {
    editingContactId = null,
    allContacts = [contact],
    editName = contact.name,
    editAliases = contact.aliases.join(', '),
    onSaveContactOverride = () => undefined,
    onComposeToContact = () => undefined,
    onToggleContactVip = () => undefined,
    onDeleteContact = () => undefined,
    onStartEditContact = () => undefined,
  } = options;
  return render(
    <ContactAutomationSettings
      contactForm={contactForm}
      contactFormAliases=""
      contacts={allContacts}
      filteredContacts={allContacts}
      contactQuery=""
      editingContactId={editingContactId}
      editName={editName}
      editAliases={editAliases}
      transferBusy={false}
      onContactFormChange={() => undefined}
      onContactFormAliasesChange={() => undefined}
      onContactQueryChange={() => undefined}
      onCreateContact={async () => undefined}
      onEditNameChange={() => undefined}
      onEditAliasesChange={() => undefined}
      onSaveContactOverride={onSaveContactOverride}
      onCancelEdit={() => undefined}
      onComposeToContact={onComposeToContact}
      onStartEditContact={onStartEditContact}
      onToggleContactVip={onToggleContactVip}
      onDeleteContact={onDeleteContact}
      onExportContacts={() => undefined}
      onRefreshContacts={async () => allContacts}
      onStatus={() => undefined}
    />,
  );
}

function openDetails() {
  fireEvent.click(screen.getByText('Ada Lovelace'));
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
    const startEdit = vi.fn();
    renderSettings({ onStartEditContact: startEdit });

    openDetails();
    expect(screen.getByRole('dialog', { name: 'Ada Lovelace' })).not.toBeNull();
    expect(screen.getByText('ada@work.example')).not.toBeNull();
    expect(screen.queryByText('合并联系人')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByRole('dialog', { name: '编辑联系人' })).not.toBeNull();
    expect(startEdit).toHaveBeenCalledWith(contact);
    expect(screen.getByRole('textbox', { name: '显示名称' })).not.toBeNull();
    expect(screen.getByRole('textbox', { name: /别名邮箱/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: '保存' })).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the read-only primary email and editable display name in the edit dialog', () => {
    renderSettings();

    openDetails();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    const primaryEmail = screen.getByRole('group', { name: '主邮箱' });
    expect(primaryEmail.textContent).toContain('ada@example.com');
    expect(primaryEmail.querySelector('input')).toBeNull();
    expect(screen.queryByRole('textbox', { name: '主邮箱' })).toBeNull();

    const nameField = screen.getByRole('textbox', { name: '显示名称' }) as HTMLInputElement;
    expect(nameField.value).toBe('Ada Lovelace');
    expect(screen.getByText('可用逗号、分号或换行分隔多个别名。')).not.toBeNull();
  });

  it('saves edits with the primary action and cancels without saving', async () => {
    const save = vi.fn(async () => undefined);
    renderSettings({ onSaveContactOverride: save });

    openDetails();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledWith(contact);

    openDetails();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps 写信 as the primary action and groups the secondary and danger actions', () => {
    const compose = vi.fn();
    renderSettings({ onComposeToContact: compose });

    openDetails();
    const writeButton = screen.getByRole('button', { name: '写信' });
    expect(writeButton.className).toContain('st-btn-primary');
    fireEvent.click(writeButton);
    expect(compose).toHaveBeenCalledWith(contact);

    expect(screen.getByRole('button', { name: '设为 VIP' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '编辑' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '删除' })).not.toBeNull();
  });

  it('toggles VIP from the details dialog and reflects the pending state', () => {
    const toggleVip = vi.fn();
    renderSettings({ onToggleContactVip: toggleVip });

    openDetails();
    fireEvent.click(screen.getByRole('button', { name: '设为 VIP' }));
    expect(toggleVip).toHaveBeenCalledWith(contact);
    expect(screen.getByRole('button', { name: '取消 VIP' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '取消 VIP' }));
    expect(toggleVip).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '设为 VIP' })).not.toBeNull();
  });

  it('deletes from the details dialog and closes it', () => {
    const remove = vi.fn();
    renderSettings({ onDeleteContact: remove });

    openDetails();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(remove).toHaveBeenCalledWith(contact);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows an explicit empty state when a contact has no aliases', () => {
    renderSettings({ allContacts: [{ ...contact, aliases: [] }] });

    openDetails();
    expect(screen.getByText('未设置')).not.toBeNull();
    expect(screen.queryByText('未设置别名')).toBeNull();
  });

  it('focuses the display name field when the edit dialog opens', () => {
    renderSettings();

    openDetails();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '显示名称' }));
  });

  it('focuses the close button when the details dialog opens', () => {
    renderSettings();

    openDetails();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  });

  it('wraps Tab focus inside the open dialog', () => {
    renderSettings();

    openDetails();
    const closeButton = screen.getByRole('button', { name: '关闭' });
    const lastAction = screen.getByRole('button', { name: '编辑' });

    lastAction.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastAction);
  });

  it('closes via the backdrop click', () => {
    const { container } = renderSettings();

    openDetails();
    const backdrop = container.querySelector('.settings-contact-dialog-backdrop');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
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
    renderSettings({ allContacts: contacts });
    expect(screen.getByText('Contact 1')).not.toBeNull();
    expect(screen.queryByText('Contact 9')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('Contact 9')).not.toBeNull();
  });
});
