import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Message } from '../../app/types';
import ReaderToolbar from './ReaderToolbar';

afterEach(cleanup);

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    account_id: 1,
    account_email: 'me@example.com',
    folder_id: 1,
    folder_role: 'inbox',
    sender_name: 'Ada',
    sender_email: 'ada@example.com',
    recipients: 'me@example.com',
    cc: '',
    bcc: '',
    subject: '设计评审',
    snippet: '请查看设计稿。',
    body: '请查看设计稿。',
    sanitized_html: '',
    security_warnings: [],
    received_at: '2026-08-25T09:00:00+08:00',
    is_read: true,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: 1,
    message_id_header: '',
    in_reply_to_header: '',
    references_header: '',
    ...overrides,
  };
}

function renderToolbar(
  selected = message(),
  overrides: Partial<ComponentProps<typeof ReaderToolbar>> = {},
) {
  return render(
    <ReaderToolbar
      selected={selected}
      folders={[]}
      selectedSenderTrusted
      selectedSenderDomain=""
      selectedExternalBlocked={false}
      onTrustRemoteImages={vi.fn()}
      onBlockSender={vi.fn()}
      needsTranslation={false}
      translationActive={false}
      translationCompleted={false}
      translationLoading={false}
      onTranslateMessage={vi.fn()}
      onToggleTranslation={vi.fn()}
      onToggleStar={vi.fn()}
      onEditDraft={vi.fn()}
      onComposeFromMessage={vi.fn()}
      onRestoreFromTrash={vi.fn()}
      onMoveArchive={vi.fn()}
      onToggleRead={vi.fn()}
      onMoveTrash={vi.fn()}
      onUnsnooze={vi.fn()}
      onSnooze={vi.fn()}
      onExportMessage={vi.fn()}
      onFetchBody={vi.fn()}
      onMarkNotSpam={vi.fn()}
      onMarkAsSpam={vi.fn()}
      onPermanentlyDelete={vi.fn()}
      onEmptyTrash={vi.fn()}
      onMoveToFolder={vi.fn()}
      {...overrides}
    />,
  );
}

describe('ReaderToolbar common actions', () => {
  it('keeps reply, star, archive, snooze, and more visible', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: '回复' })).toBeDefined();
    expect(screen.getByRole('button', { name: '添加星标' })).toBeDefined();
    expect(screen.getByRole('button', { name: '归档' })).toBeDefined();
    expect(screen.getByRole('button', { name: '稍后处理' })).toBeDefined();
    expect(screen.getByTitle('更多操作')).toBeDefined();
    expect(screen.queryByRole('button', { name: '更多回复方式' })).toBeNull();
  });

  it('moves reply-all and forward into the more menu', () => {
    renderToolbar();

    fireEvent.click(screen.getByTitle('更多操作'));

    expect(screen.getByRole('button', { name: '回复全部' })).toBeDefined();
    expect(screen.getByRole('button', { name: '转发' })).toBeDefined();
  });

  it('switches the visible clock action to unsnooze for snoozed mail', () => {
    const onUnsnooze = vi.fn();
    renderToolbar(message({ folder_role: 'snoozed' }), { onUnsnooze });

    expect(screen.getByRole('button', { name: '取消稍后处理' })).toBeDefined();
    expect(screen.queryByRole('button', { name: '稍后处理' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '取消稍后处理' }));
    expect(onUnsnooze).toHaveBeenCalledOnce();
  });
});
