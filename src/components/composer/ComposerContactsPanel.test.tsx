import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { emptyDraft } from '../../app/composerConfig';
import type { Contact } from '../../app/types';
import ComposerContactsPanel from './ComposerContactsPanel';

afterEach(cleanup);

const ada: Contact = {
  id: 1,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  aliases: ['ada@work.example.com'],
  vip: true,
  message_count: 12,
  last_seen_at: '2026-08-24T10:00:00+08:00',
};

const grace: Contact = {
  id: 2,
  name: 'Grace Hopper',
  email: 'grace@example.com',
  aliases: [],
  vip: false,
  message_count: 4,
  last_seen_at: '2026-08-25T10:00:00+08:00',
};

const lin: Contact = {
  id: 3,
  name: 'Lin Chen',
  email: 'lin@example.com',
  aliases: [],
  vip: false,
  message_count: 1,
  last_seen_at: '2026-08-20T10:00:00+08:00',
};

const newcomer: Contact = {
  id: 4,
  name: 'New Contact',
  email: 'new@example.com',
  aliases: [],
  vip: false,
  message_count: 0,
  last_seen_at: '2026-08-25T11:00:00+08:00',
};

const emailOnly: Contact = {
  id: 5,
  name: '',
  email: 'noreply@example.com',
  aliases: [],
  vip: false,
  message_count: 0,
  last_seen_at: '2026-08-25T09:00:00+08:00',
};

function renderPanel(draft = emptyDraft) {
  return render(
    <ComposerContactsPanel
      contacts={[ada, grace, lin, newcomer]}
      draft={draft}
      activeRecipientField="to"
      onRecipientFieldChange={vi.fn()}
      onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
      onClose={vi.fn()}
    />,
  );
}

describe('ComposerContactsPanel', () => {
  it('searches contacts and adds the selected contact to the chosen recipient field', () => {
    const onAddContacts = vi.fn(() => ({ addedIds: [grace.id], skippedIds: [] }));
    const onRecipientFieldChange = vi.fn();
    const view = render(
      <ComposerContactsPanel
        contacts={[ada, grace, lin, newcomer]}
        draft={emptyDraft}
        activeRecipientField="to"
        onRecipientFieldChange={onRecipientFieldChange}
        onAddContacts={onAddContacts}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索联系人' }), {
      target: { value: 'grace@' },
    });
    expect(screen.getByText('Grace Hopper')).not.toBeNull();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '选择 Grace Hopper' }));
    fireEvent.click(screen.getByRole('button', { name: '选择添加目标' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '抄送' }));
    expect(onRecipientFieldChange).toHaveBeenCalledWith('cc');

    view.rerender(
      <ComposerContactsPanel
        contacts={[ada, grace, lin, newcomer]}
        draft={emptyDraft}
        activeRecipientField="cc"
        onRecipientFieldChange={onRecipientFieldChange}
        onAddContacts={onAddContacts}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '添加到抄送' }));

    expect(onAddContacts).toHaveBeenCalledWith([grace], 'cc');
  });

  it('switches to frequent contacts and marks recipients already in the draft', () => {
    renderPanel({ ...emptyDraft, to: 'ada@example.com' });

    fireEvent.click(screen.getByRole('tab', { name: /常用联系人/ }));
    expect(screen.getAllByRole('listitem')[0].getAttribute('data-contact-id')).toBe('1');
    expect(screen.queryByText('New Contact')).toBeNull();

    const added = screen.getByRole('button', { name: 'Ada Lovelace已添加到收件人' });
    expect(added).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: '添加 Grace Hopper' })).toBeNull();
  });

  it('shows a useful empty state when the search has no match', () => {
    renderPanel();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索联系人' }), {
      target: { value: 'nobody@example.com' },
    });

    expect(screen.getByText('没有找到匹配联系人')).not.toBeNull();
    expect(screen.getByText('试试搜索其他姓名或邮箱')).not.toBeNull();
  });

  it('does not repeat an email-only contact address in the secondary line', () => {
    render(
      <ComposerContactsPanel
        contacts={[emailOnly]}
        draft={emptyDraft}
        activeRecipientField="to"
        onRecipientFieldChange={vi.fn()}
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('noreply@example.com')).not.toBeNull();
    expect(screen.queryByText('邮箱地址', { selector: '.composer-contact-copy small' })).toBeNull();
  });

  it('treats a backend fallback name equal to the email as email-only', () => {
    render(
      <ComposerContactsPanel
        contacts={[{ ...emailOnly, name: emailOnly.email }]}
        draft={emptyDraft}
        activeRecipientField="to"
        onRecipientFieldChange={vi.fn()}
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByText('noreply@example.com')).toHaveLength(1);
    expect(screen.queryByText('noreply@example.com', { selector: '.composer-contact-copy small' })).toBeNull();
  });

  it('uses the generic avatar for an email-only contact with a numeric address', () => {
    const numericContact = { ...emailOnly, email: '006973@chinatelecom.cn', name: '006973@chinatelecom.cn' };
    render(
      <ComposerContactsPanel
        contacts={[numericContact]}
        draft={emptyDraft}
        activeRecipientField="to"
        onRecipientFieldChange={vi.fn()}
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('listitem').querySelector('.composer-contact-avatar svg')).not.toBeNull();
  });

  it('keeps the empty address-book state actionable', () => {
    const onOpenContactsSettings = vi.fn();
    render(
      <ComposerContactsPanel
        contacts={[]}
        draft={emptyDraft}
        activeRecipientField="to"
        onRecipientFieldChange={vi.fn()}
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
        onOpenContactsSettings={onOpenContactsSettings}
      />,
    );

    expect(screen.getByRole('complementary', { name: '联系人' }).id).toBe('composer-contacts-panel');
    expect(screen.getByText('还没有联系人', { selector: '.composer-contacts-empty strong' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '添加到收件人' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: '管理联系人' }));
    expect(onOpenContactsSettings).toHaveBeenCalledTimes(1);
  });

  it('can hide its close action when the rail is persistent', () => {
    render(
      <ComposerContactsPanel
        contacts={[]}
        draft={emptyDraft}
        activeRecipientField="to"
        onRecipientFieldChange={vi.fn()}
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
        showClose={false}
      />,
    );

    expect(screen.queryByRole('button', { name: '关闭联系人面板' })).toBeNull();
  });

  it('does not expose a group tab when the contact backend has no group data', () => {
    renderPanel();

    expect(screen.queryByRole('tab', { name: '群组' })).toBeNull();
    expect(screen.getByPlaceholderText('搜索姓名或邮箱')).not.toBeNull();
  });
});
