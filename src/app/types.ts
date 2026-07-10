export type SystemFolderRole = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam' | 'snoozed' | 'custom';
export type FolderRole = SystemFolderRole | `custom:${string}`;
export type FilterMode = 'all' | 'unread' | 'starred' | 'attachments';
export type ListMode = 'messages' | 'threads';
export type AccountScope = number | 'all';
export type ProviderVerificationStatus = 'untested' | 'passed' | 'partial' | 'failed';
export type BackgroundTaskKind = 'sync' | 'outbox-dry-run' | 'outbox-smtp';
export type BackgroundTaskStatus = 'queued' | 'running' | 'done' | 'failed';

export type Account = {
  id: number;
  email: string;
  display_name: string;
  provider: string;
  imap_host: string;
  smtp_host: string;
  auth_type: string;
  sync_mode: string;
  remote_images_allowed: boolean;
  signature: string;
  is_default: boolean;
};

export type AccountCreateInput = Omit<Account, 'id' | 'is_default'>;

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
};

export type Attachment = {
  id: number;
  message_id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  is_downloaded: boolean;
  local_path: string;
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
};

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

export type CommandPaletteItem = {
  id: string;
  title: string;
  section: string;
  hint: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
};

export type RemoteImageTrust = {
  id: number;
  account_id: number;
  account_email: string;
  scope: 'sender' | 'domain';
  value: string;
  created_at: string;
};

export type MailIdentity = {
  id: number;
  account_id: number;
  name: string;
  email: string;
  reply_to: string;
  signature: string;
  is_default: boolean;
};

export type MailIdentityInput = {
  id: number;
  account_id: number;
  name: string;
  email: string;
  reply_to: string;
  signature: string;
  is_default: boolean;
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

export type MailStats = {
  total_messages: number;
  unread_messages: number;
  starred_messages: number;
  draft_messages: number;
  attachment_messages: number;
};

export type LocalBackupSummary = {
  path: string;
  exported_at: string;
  app_version: string;
  schema_version: number;
  accounts: number;
  messages: number;
  labels: number;
  rules: number;
  outbox_items: number;
  size_bytes: number;
  credentials_included: boolean;
};

export type EndpointCheck = {
  name: string;
  address: string;
  reachable: boolean;
  latency_ms: number | null;
  message: string;
};

export type ConnectionReport = {
  account_email: string;
  checked_at: string;
  endpoints: EndpointCheck[];
  ready_for_credentials: boolean;
};

export type CredentialProtocolCheck = {
  name: string;
  address: string;
  authenticated: boolean;
  message: string;
};

export type CredentialVerificationReport = {
  account_email: string;
  checked_at: string;
  checks: CredentialProtocolCheck[];
  authenticated: boolean;
  status: 'ok' | 'partial' | 'error' | 'credential_error';
  message: string;
};

export type ImapFolderProbe = {
  name: string;
  delimiter: string;
  attributes: string[];
};

export type ImapProbeReport = {
  account_email: string;
  checked_at: string;
  folder_count: number;
  folders: ImapFolderProbe[];
  status: string;
  message: string;
};

export type ImapMailboxState = {
  id: number;
  account_id: number;
  account_email: string;
  remote_name: string;
  delimiter: string;
  attributes: string;
  local_role: string;
  local_folder_id: number | null;
  local_folder_name: string;
  uid_validity: string;
  highest_uid: number;
  lowest_uid: number;
  history_complete: boolean;
  history_last_sync_at: string;
  last_seen_at: string;
  last_sync_at: string;
};

export type SyncRun = {
  id: number;
  started_at: string;
  finished_at: string;
  status: string;
  scanned_folders: number;
  imported_messages: number;
  message: string;
};

export type SyncSchedulePlan = {
  max_accounts_per_batch: number;
  total_accounts: number;
  batch_accounts: Account[];
  delayed_accounts: Account[];
  strategy: string;
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

export type Contact = {
  id: number;
  name: string;
  email: string;
  aliases: string[];
  vip: boolean;
  message_count: number;
  last_seen_at: string;
};

export type ContactMergeSuggestion = {
  target: Contact;
  source: Contact;
  reason: string;
  shared_keys: string[];
};

export type ContactCreateInput = {
  name: string;
  email: string;
  aliases: string[];
  vip: boolean;
};

export type MailRule = {
  id: number;
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
};

export type MailRuleInput = {
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
};

export type ThreadSummary = {
  thread_key: string;
  subject: string;
  message_count: number;
  unread_count: number;
  latest_at: string;
  participants: string;
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

export type CredentialStatus = {
  account_email: string;
  exists: boolean;
  message: string;
};

export type OAuthStartReport = {
  session_id: number;
  provider: string;
  authorization_url: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_verifier_hint: string;
  scopes: string[];
  message: string;
};

export type OAuthSession = {
  id: number;
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

export type OAuthCallbackReport = {
  session_id: number;
  provider: string;
  status: string;
  message: string;
};

export type OAuthTokenExchangeReport = {
  session_id: number;
  provider: string;
  status: string;
  expires_at: string;
  message: string;
};

export type OAuthRefreshReport = {
  provider: string;
  status: string;
  expires_at: string;
  message: string;
};

export type ProviderVerificationRecord = {
  provider_key: string;
  provider_label: string;
  status: ProviderVerificationStatus;
  imap_ok: boolean;
  smtp_ok: boolean;
  oauth_ok: boolean;
  diagnostic_exported: boolean;
  checked_at: string;
  notes: string;
};

export type BackgroundTask = {
  id: number;
  kind: BackgroundTaskKind;
  title: string;
  source: 'manual' | 'timer';
  status: BackgroundTaskStatus;
  message: string;
  created_at: string;
  started_at: string;
  finished_at: string;
};

export type AppLayout = {
  sidebar: number;
  list: number;
};
