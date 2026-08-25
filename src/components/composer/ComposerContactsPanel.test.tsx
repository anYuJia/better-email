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

function renderPanel(draft = emptyDraft) {
  return render(
    <ComposerContactsPanel
      contacts={[ada, grace, lin, newcomer]}
      draft={draft}
      onAddContact={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('ComposerContactsPanel', () => {
  it('searches contacts and adds the selected contact to the chosen recipient field', () => {
    const onAddContact = vi.fn();
    render(
      <ComposerContactsPanel
        contacts={[ada, grace, lin, newcomer]}
        draft={emptyDraft}
        onAddContact={onAddContact}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索联系人' }), {
      target: { value: 'grace@' },
    });
    expect(screen.getByText('Grace Hopper')).not.toBeNull();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '抄送' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 Grace Hopper' }));

    expect(onAddContact).toHaveBeenCalledWith(grace, 'cc');
  });

  it('switches to frequent contacts and marks recipients already in the draft', () => {
    renderPanel({ ...emptyDraft, to: 'ada@example.com' });

    fireEvent.click(screen.getByRole('tab', { name: /常用联系人/ }));
    expect(screen.getAllByRole('listitem')[0].getAttribute('data-contact-id')).toBe('1');
    expect(screen.queryByText('New Contact')).toBeNull();

    const added = screen.getByRole('button', { name: 'Ada Lovelace已添加' });
    expect(added).toHaveProperty('disabled', true);
  });

  it('shows a useful empty state when the search has no match', () => {
    renderPanel();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索联系人' }), {
      target: { value: 'nobody@example.com' },
    });

    expect(screen.getByText('没有找到匹配联系人')).not.toBeNull();
    expect(screen.getByText('试试搜索其他姓名或邮箱')).not.toBeNull();
  });

  it('keeps the empty address-book state actionable', () => {
    const onOpenContactsSettings = vi.fn();
    render(
      <ComposerContactsPanel
        contacts={[]}
        draft={emptyDraft}
        onAddContact={vi.fn()}
        onClose={vi.fn()}
        onOpenContactsSettings={onOpenContactsSettings}
      />,
    );

    expect(screen.getByRole('complementary', { name: '联系人' }).id).toBe('composer-contacts-panel');
    expect(screen.getByText('还没有联系人', { selector: '.composer-contacts-empty strong' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '收件人' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '管理联系人' }));
    expect(onOpenContactsSettings).toHaveBeenCalledTimes(1);
  });
});
