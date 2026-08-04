import type { OutboundAttachmentInput } from './message';

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
};


export type DraftSaveReport = {
  draft_id: number;
  remote_attempted: boolean;
  remote_synced: boolean;
  remote_mailbox: string;
  remote_uid: number;
  message: string;
};


export type ComposeTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  html_body: string;
};


export type ComposerAutosave = {
  draft: DraftInput;
  isRichComposer: boolean;
  saved_at: string;
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

