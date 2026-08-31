import { describe, expect, it } from 'vitest';
import type { FolderRole, MessageSummary } from './types';
import {
  buildMessageCollectionActionState,
  collectionActionDetail,
  messagesForCollectionAction,
  primaryMessageCollectionActions,
} from './messageActionState';

function message(id: number, folderRole: FolderRole, overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id,
    account_id: 1,
    account_email: 'demo@example.com',
    folder_id: 1,
    folder_role: folderRole,
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    recipients: 'demo@example.com',
    cc: '',
    bcc: '',
    subject: `Subject ${id}`,
    snippet: 'Snippet',
    security_warnings: [],
    received_at: '2026-08-31T10:00:00+08:00',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: id,
    ...overrides,
  };
}

function actions(messages: MessageSummary[], scope: 'bulk' | 'thread' = 'bulk') {
  return buildMessageCollectionActionState(messages, scope).entries.map((item) => item.action);
}

describe('message collection action state', () => {
  it('uses one aggregate read and star action and targets only messages that change', () => {
    const unread = message(1, 'inbox');
    const readAndStarred = message(2, 'inbox', { is_read: true, is_starred: true });
    const state = buildMessageCollectionActionState([unread, readAndStarred]);
    const readEntry = state.entries.find((item) => item.action === 'read');
    const starEntry = state.entries.find((item) => item.action === 'star');

    expect(actions([unread, readAndStarred]).filter((action) => action === 'read' || action === 'unread')).toEqual(['read']);
    expect(actions([unread, readAndStarred]).filter((action) => action === 'star' || action === 'unstar')).toEqual(['star']);
    expect(readEntry?.messages.map((item) => item.id)).toEqual([unread.id]);
    expect(starEntry?.messages.map((item) => item.id)).toEqual([unread.id]);
    expect(collectionActionDetail(readEntry?.messages.length ?? 0, state.totalCount)).toBe('1/2 封可处理');
  });

  it('switches trash selection to restore and permanent delete', () => {
    const selected = [message(1, 'trash'), message(2, 'trash')];
    const state = buildMessageCollectionActionState(selected);

    expect(actions(selected)).toEqual([
      'read',
      'star',
      'restore',
      'permanent-delete',
    ]);
    expect(primaryMessageCollectionActions(state).map((item) => item.action)).toEqual([
      'restore',
      'permanent-delete',
    ]);
  });

  it('switches spam and snoozed selections to their inverse state actions', () => {
    expect(actions([message(1, 'spam')])).toContain('not-spam');
    expect(actions([message(1, 'spam')])).not.toContain('spam');
    expect(actions([message(1, 'spam')])).not.toContain('archive');
    expect(actions([message(1, 'spam')])).not.toContain('snooze');
    expect(actions([message(2, 'snoozed')])).toContain('unsnooze');
    expect(actions([message(2, 'snoozed')])).not.toContain('snooze');
  });

  it('does not expose read, archive, or spam state changes for drafts', () => {
    expect(actions([message(1, 'drafts')])).toEqual(['star', 'trash']);
  });

  it('keeps thread draft messages out of destructive thread actions', () => {
    const draft = message(1, 'drafts');
    const inbox = message(2, 'inbox');

    expect(messagesForCollectionAction([draft, inbox], 'trash', 'bulk').map((item) => item.id)).toEqual([1, 2]);
    expect(messagesForCollectionAction([draft, inbox], 'trash', 'thread').map((item) => item.id)).toEqual([2]);
    expect(messagesForCollectionAction([draft, inbox], 'archive', 'thread').map((item) => item.id)).toEqual([2]);
  });
});
