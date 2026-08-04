import type { FolderRole } from './mailbox';

export type Attachment = {
  id: number;
  message_id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  is_downloaded: boolean;
  local_path: string;
  content_id: string;
  is_inline: boolean;
};


export type OutboundAttachmentInput = {
  filename: string;
  mime_type: string;
  size_bytes: number;
  local_path: string;
};


export type DroppedFile = File & { path?: string };


export type AttachmentDownload = {
  attachment: Attachment;
  local_path: string;
  message: string;
};


export type Message = {
  id: number;
  account_id: number;
  account_email: string;
  folder_id: number;
  folder_role: FolderRole;
  sender_name: string;
  sender_email: string;
  recipients: string;
  cc: string;
  bcc: string;
  subject: string;
  snippet: string;
  body: string;
  sanitized_html: string;
  security_warnings: string[];
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  snoozed_until: string;
  labels: string[];
  attachment_count: number;
  remote_mailbox: string;
  remote_uid: number;
  message_id_header?: string;
  in_reply_to_header?: string;
  references_header?: string;
};


export type MessageSummary = Omit<Message, 'body' | 'sanitized_html'>;


export type UndoMessageSnapshot = {
  id: number;
  subject: string;
  account_id: number;
  folder_role: FolderRole;
  is_read: boolean;
  is_starred: boolean;
  snoozed_until: string;
  labels: string[];
};


export type UndoAction = {
  id: string;
  title: string;
  detail: string;
  snapshots: UndoMessageSnapshot[];
};


export type RemoteImageTrust = {
  id: number;
  account_id: number;
  account_email: string;
  scope: 'sender' | 'domain';
  value: string;
  created_at: string;
};


export type RemoteActionReport = {
  local_applied: boolean;
  remote_attempted: boolean;
  remote_applied: boolean;
  message: string;
};


export type RestoreMessageReport = {
  restored: Message;
  remote: RemoteActionReport;
};


export type TrashActionReport = {
  local_deleted_count: number;
  remote_attempted_count: number;
  remote_applied_count: number;
  remote_skipped_count: number;
  remote_failed_count: number;
  message: string;
};


export type FolderReadReport = {
  updated_count: number;
  remote_attempted_count: number;
  remote_applied_count: number;
  remote_skipped_count: number;
  remote_failed_count: number;
  message: string;
};


export type ParsedMessagePreview = {
  subject: string;
  from: string;
  to: string;
  body_preview: string;
  sanitized_html: string;
  attachment_count: number;
  attachment_names: string[];
  warning_count: number;
  warnings: string[];
};

