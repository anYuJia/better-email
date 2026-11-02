import type { OutboundAttachmentInput } from './message';

/** Frontend recovery provenance. Never used to construct MIME or choose recipients. */
export type QuickReplyDraftSource = {
  key: string;
  body: string;
  revision: string;
  mode: 'reply' | 'replyAll';
};

export type DraftInput = {
  draft_id: number;
  account_id: number;
  identity_id: number;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  html_body: string;
  send_at: string;
  attachments: OutboundAttachmentInput[];
  in_reply_to?: string;
  references?: string;
  quick_reply_source?: QuickReplyDraftSource;
};


export type DraftSaveReport = {
  draft_id: number;
  remote_attempted: boolean;
  remote_synced: boolean;
  remote_mailbox: string;
  remote_uid: number;
  message: string;
};

export type ComposerSaveResult =
  | { status: 'saved' }
  | { status: 'blocked' | 'empty'; message: string };


export type ComposeTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  html_body: string;
  category: string;
  tags: string[];
  account_id: number;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
};


export type PendingAttachmentRecovery = {
  filename: string;
  size_bytes: number | null;
  is_inline: boolean;
  selection_unknown?: true;
};

export type ComposerAutosave = {
  save_state?: 'saving' | 'saved' | 'error';
  save_error?: string;
  draft: DraftInput;
  isRichComposer: boolean;
  saved_at: string;
  pending_attachments?: PendingAttachmentRecovery[];
};


export type OutboxItem = {
  id: number;
  message_id: number;
  recipients: string;
  subject: string;
  status: string;
  attempts: number;
  last_error: string;
  queued_at: string;
  next_attempt_at: string;
};
