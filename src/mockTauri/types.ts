import type { Message } from '../app/types';

export type InvokeArgs = Record<string, any> | undefined;
export type MockMessage = Omit<Message, 'folder_role'> & { folder_role: string };

export type DesktopFileDropEvent =
  | { type: 'enter'; paths: string[]; position?: unknown }
  | { type: 'over'; position?: unknown }
  | { type: 'drop'; paths: string[]; position?: unknown }
  | { type: 'leave' };
export type DesktopFileDropHandler = (event: DesktopFileDropEvent) => void;

export type MockIdentity = {
  id: number;
  account_id: number;
  name: string;
  email: string;
  reply_to: string;
  signature: string;
  is_default: boolean;
};

export type MockFolder = {
  id: number;
  account_id: number | null;
  name: string;
  role: string;
  unread_count: number;
  is_virtual: boolean;
};

export type MockDraftInput = {
  draft_id?: number;
  account_id?: number;
  identity_id?: number;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  html_body?: string;
  send_at?: string;
  attachments?: MockOutboundAttachmentInput[];
};

export type MockThreadingInput = {
  in_reply_to?: string;
  references?: string;
};

export type MockOutboundAttachmentInput = {
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
  local_path?: string;
  content_id?: string;
  is_inline?: boolean;
};

export type MockContact = {
  id: number;
  name: string;
  email: string;
  aliases: string[];
  vip: boolean;
  message_count: number;
  last_seen_at: string;
};

export type MockBackgroundTask = {
  id: number;
  kind: string;
  title: string;
  source: string;
  status: string;
  message: string;
  created_at: string;
  started_at: string;
  finished_at: string;
};

export type MockSyncRun = {
  id: number;
  started_at: string;
  finished_at: string;
  status: string;
  scanned_folders: number;
  imported_messages: number;
  message: string;
};

export type MockOAuthSession = {
  id: number;
  account_id: number;
  provider: string;
  authorization_url: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  scopes: string[];
  status: string;
  created_at: string;
  completed_at: string;
  message: string;
};

export type MockCommandHandler = (args?: InvokeArgs) => unknown;
