import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { emptyDraft } from '../../app/composerConfig';
import type { Contact } from '../../app/types';
import ComposerContactsPanel from './ComposerContactsPanel';

afterEach(cleanup);

const ada: Contact = {
  id: 1,
  account_id: 1,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  aliases: ['ada@work.example.com'],
  vip: true,
  message_count: 12,
  last_seen_at: '2026-08-24T10:00:00+08:00',
};

const grace: Contact = {
  id: 2,
  account_id: 1,
  name: 'Grace Hopper',
  email: 'grace@example.com',
  aliases: [],
  vip: false,
  message_count: 4,
  last_seen_at: '2026-08-25T10:00:00+08:00',
};

const lin: Contact = {
  id: 3,
  account_id: 1,
  name: 'Lin Chen',
  email: 'lin@example.com',
  aliases: [],
  vip: false,
  message_count: 1,
  last_seen_at: '2026-08-20T10:00:00+08:00',
};

const newcomer: Contact = {
  id: 4,
  account_id: 1,
  name: 'New Contact',
  email: 'new@example.com',
  aliases: [],
  vip: false,
  message_count: 0,
  last_seen_at: '2026-08-25T11:00:00+08:00',
};

const emailOnly: Contact = {
  id: 5,
  account_id: 1,
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
      onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
      onClose={vi.fn()}
    />,
  );
}

describe('ComposerContactsPanel', () => {
  it('searches contacts and adds a contact from its row action', () => {
    const onAddContacts = vi.fn(() => ({ addedIds: [grace.id], skippedIds: [] }));
    render(
      <ComposerContactsPanel
        contacts={[ada, grace, lin, newcomer]}
        draft={emptyDraft}
        activeRecipientField="to"
        onAddContacts={onAddContacts}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索联系人' }), {
      target: { value: 'grace@' },
    });
    expect(screen.getByText('Grace Hopper')).not.toBeNull();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();

    const row = screen.getByRole('listitem', { name: 'Grace Hopper，按回车添加到收件人' });
    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByRole('button', { name: '添加 Grace Hopper 到收件人' }));

    expect(onAddContacts).toHaveBeenCalledWith([grace], 'to');
  });

  it('uses the currently focused recipient field as the row action target', () => {
    const onAddContacts = vi.fn(() => ({ addedIds: [grace.id], skippedIds: [] }));
    render(
      <ComposerContactsPanel
        contacts={[ada, grace, lin, newcomer]}
        draft={emptyDraft}
        activeRecipientField="cc"
        onAddContacts={onAddContacts}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加 Grace Hopper 到抄送' }));
    expect(onAddContacts).toHaveBeenCalledWith([grace], 'cc');
  });

  it('switches to frequent contacts and marks recipients already in the draft', () => {
    renderPanel({ ...emptyDraft, to: 'ada@example.com' });

    fireEvent.click(screen.getByRole('tab', { name: /常用联系人/ }));
    expect(screen.getAllByRole('listitem')[0].getAttribute('data-contact-id')).toBe('1');
    expect(screen.queryByText('New Contact')).toBeNull();

    const added = screen.getByText('已添加', { selector: '.composer-contact-add' });
    expect(added.classList.contains('is-added')).toBe(true);
    expect(screen.getByRole('button', { name: '添加 Grace Hopper 到收件人' })).not.toBeNull();
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
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
        onOpenContactsSettings={onOpenContactsSettings}
      />,
    );

    expect(screen.getByRole('complementary', { name: '联系人' }).id).toBe('composer-contacts-panel');
    expect(screen.getByText('还没有联系人', { selector: '.composer-contacts-empty strong' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '添加到收件人' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '管理联系人' }));
    expect(onOpenContactsSettings).toHaveBeenCalledTimes(1);
  });

  it('can hide its close action when the rail is persistent', () => {
    render(
      <ComposerContactsPanel
        contacts={[]}
        draft={emptyDraft}
        activeRecipientField="to"
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
        showClose={false}
      />,
    );

    expect(screen.queryByRole('button', { name: '关闭联系人面板' })).toBeNull();
  });

  it('keeps the scan control centered between the contacts title and management actions', () => {
    render(
      <ComposerContactsPanel
        contacts={[]}
        draft={emptyDraft}
        activeRecipientField="to"
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
        onOpenContactsSettings={vi.fn()}
        onScanRecentContacts={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const header = document.querySelector('.composer-contacts-header');
    expect(header).not.toBeNull();
    expect(Array.from(header!.children).map((child) => child.className)).toEqual([
      'composer-contacts-heading',
      'composer-contacts-scan',
      'composer-contacts-heading-actions',
    ]);
    expect(screen.getByRole('button', { name: '扫描同步最近联系人' }).classList.contains('composer-contacts-scan')).toBe(true);
  });

  it('does not expose a group tab when the contact backend has no group data', () => {
    renderPanel();

    expect(screen.queryByRole('tab', { name: '群组' })).toBeNull();
    expect(screen.getByPlaceholderText('搜索姓名或邮箱')).not.toBeNull();
  });

  it('scans recent contacts on explicit user action and explains the data source', async () => {
    const onScanRecentContacts = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerContactsPanel
        contacts={[]}
        draft={emptyDraft}
        activeRecipientField="to"
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
        onScanRecentContacts={onScanRecentContacts}
      />,
    );

    const button = screen.getByRole('button', { name: '扫描同步最近联系人' });
    expect(button.getAttribute('title')).toBe('通过扫描已发送邮件头，获取联系人的姓名(若设置了别名)、邮箱地址等');
    fireEvent.click(button);
    await waitFor(() => expect(onScanRecentContacts).toHaveBeenCalledTimes(1));
  });

  it('disables repeated scans while the synchronization request is pending', async () => {
    let resolveScan: (() => void) | undefined;
    const onScanRecentContacts = vi.fn(() => new Promise<void>((resolve) => {
      resolveScan = resolve;
    }));
    render(
      <ComposerContactsPanel
        contacts={[]}
        draft={emptyDraft}
        activeRecipientField="to"
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
        onScanRecentContacts={onScanRecentContacts}
      />,
    );

    const button = screen.getByRole('button', { name: '扫描同步最近联系人' });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('正在扫描…')).not.toBeNull();
    fireEvent.click(button);
    expect(onScanRecentContacts).toHaveBeenCalledTimes(1);

    resolveScan?.();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it('reorders recent contacts when the sent-mail timestamp changes', () => {
    const { rerender } = renderPanel();
    expect(screen.getAllByRole('listitem').map((row) => row.getAttribute('data-contact-id'))).toEqual([
      '4',
      '2',
      '1',
      '3',
    ]);

    rerender(
      <ComposerContactsPanel
        contacts={[{ ...ada, last_seen_at: '2026-08-27T10:00:00+08:00' }, grace, lin, newcomer]}
        draft={emptyDraft}
        activeRecipientField="to"
        onAddContacts={() => ({ addedIds: [], skippedIds: [] })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('listitem')[0].getAttribute('data-contact-id')).toBe('1');
  });
});
