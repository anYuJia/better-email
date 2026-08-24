export type SystemFolderRole = 'inbox' | 'sent' | 'drafts' | 'outbox' | 'archive' | 'trash' | 'spam' | 'snoozed' | 'custom';
export type FolderRole = SystemFolderRole | `custom:${string}`;
export type FilterMode = 'all' | 'unread' | 'starred' | 'attachments';
export type ListMode = 'messages' | 'threads';
export type ListSort = 'newest' | 'oldest' | 'sender' | 'subject';
export type AccountScope = number | 'all';
export type SearchScope = 'folder' | 'account' | 'all';
export type IncomingProtocol = 'imap' | 'pop3';

export type Folder = {
  id: number;
  account_id: number | null;
  name: string;
  role: FolderRole;
  unread_count: number;
  is_virtual: boolean;
};


export type Label = {
  id: number;
  name: string;
  color: string;
  message_count: number;
};


export type SavedSearch = {
  id: string;
  name: string;
  query: string;
  filter: FilterMode;
  scope: SearchScope;
};


export type MailStats = {
  total_messages: number;
  unread_messages: number;
  starred_messages: number;
  draft_messages: number;
  attachment_messages: number;
};


export type ThreadSummary = {
  thread_key: string;
  subject: string;
  message_count: number;
  unread_count: number;
  latest_at: string;
  latest_preview?: string;
  participants: string;
  is_muted: boolean;
};


export type AppLayout = {
  sidebar: number;
  list: number;
};
