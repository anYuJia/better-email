use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub provider: String,
    pub imap_host: String,
    pub smtp_host: String,
    pub incoming_protocol: String,
    pub auth_type: String,
    pub sync_mode: String,
    pub remote_images_allowed: bool,
    pub signature: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Folder {
    pub id: i64,
    pub account_id: Option<i64>,
    pub name: String,
    pub role: String,
    pub unread_count: i64,
    pub is_virtual: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: i64,
    pub account_id: i64,
    pub account_email: String,
    pub folder_id: i64,
    pub folder_role: String,
    pub sender_name: String,
    pub sender_email: String,
    pub recipients: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub snippet: String,
    pub body: String,
    pub sanitized_html: String,
    pub security_warnings: Vec<String>,
    pub received_at: String,
    pub is_read: bool,
    pub is_starred: bool,
    pub has_attachments: bool,
    pub snoozed_until: String,
    pub labels: Vec<String>,
    pub attachment_count: i64,
    pub remote_mailbox: String,
    pub remote_uid: i64,
    pub message_id_header: String,
    pub in_reply_to_header: String,
    pub references_header: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteImageTrust {
    pub id: i64,
    pub account_id: i64,
    pub account_email: String,
    pub scope: String,
    pub value: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoteImageTrustInput {
    pub account_id: i64,
    pub scope: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MailIdentity {
    pub id: i64,
    pub account_id: i64,
    pub name: String,
    pub email: String,
    pub reply_to: String,
    pub signature: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MailIdentityInput {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub account_id: i64,
    pub name: String,
    pub email: String,
    #[serde(default)]
    pub reply_to: String,
    #[serde(default)]
    pub signature: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DraftInput {
    #[serde(default)]
    pub draft_id: i64,
    #[serde(default)]
    pub account_id: i64,
    #[serde(default)]
    pub identity_id: i64,
    pub to: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub html_body: String,
    #[serde(default)]
    pub send_at: String,
    #[serde(default)]
    pub attachments: Vec<OutboundAttachmentInput>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct MessageThreadingInput {
    #[serde(default)]
    pub in_reply_to: String,
    #[serde(default)]
    pub references: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DraftSaveReport {
    pub draft_id: i64,
    pub remote_attempted: bool,
    pub remote_synced: bool,
    pub remote_mailbox: String,
    pub remote_uid: i64,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OutboundAttachmentInput {
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    #[serde(default)]
    pub local_path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AccountSettingsInput {
    pub display_name: String,
    pub provider: String,
    pub imap_host: String,
    pub smtp_host: String,
    pub incoming_protocol: String,
    pub auth_type: String,
    pub sync_mode: String,
    pub remote_images_allowed: bool,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AccountCreateInput {
    pub email: String,
    pub display_name: String,
    pub provider: String,
    pub imap_host: String,
    pub smtp_host: String,
    pub incoming_protocol: String,
    pub auth_type: String,
    pub sync_mode: String,
    pub remote_images_allowed: bool,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Label {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Attachment {
    pub id: i64,
    pub message_id: i64,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub is_downloaded: bool,
    pub local_path: String,
    pub content_id: String,
    pub is_inline: bool,
}

#[derive(Debug, Clone)]
pub struct RemoteAttachmentMetadata {
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub content_id: String,
    pub is_inline: bool,
}

#[derive(Debug, Clone)]
pub struct ImportedEmlAttachment {
    pub filename: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
    pub content_id: String,
    pub is_inline: bool,
}

#[derive(Debug, Clone)]
pub struct ImportedEmlMessage {
    pub sender_name: String,
    pub sender_email: String,
    pub recipients: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub body: String,
    pub sanitized_html: String,
    pub security_warnings: Vec<String>,
    pub snippet: String,
    pub received_at: String,
    pub message_id_header: String,
    pub in_reply_to_header: String,
    pub references_header: String,
    pub attachments: Vec<ImportedEmlAttachment>,
}

#[derive(Debug, Clone)]
pub struct RemoteAttachmentPayload {
    pub filename: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttachmentDownload {
    pub attachment: Attachment,
    pub local_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MailStats {
    pub total_messages: i64,
    pub unread_messages: i64,
    pub starred_messages: i64,
    pub draft_messages: i64,
    pub attachment_messages: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageUsage {
    pub database_bytes: i64,
    pub reclaimable_cache_bytes: i64,
    pub reclaimable_file_count: i64,
    pub cached_attachment_count: i64,
    pub local_attachment_bytes: i64,
    pub local_attachment_file_count: i64,
    pub partial_download_bytes: i64,
    pub partial_download_count: i64,
    pub total_managed_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CacheClearResult {
    pub removed_file_count: i64,
    pub reset_attachment_count: i64,
    pub released_bytes: i64,
    pub storage: StorageUsage,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticAccount {
    pub id: i64,
    pub email_masked: String,
    pub display_name: String,
    pub provider: String,
    pub imap_host: String,
    pub smtp_host: String,
    pub incoming_protocol: String,
    pub auth_type: String,
    pub sync_mode: String,
    pub remote_images_allowed: bool,
    pub signature_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticOAuthSession {
    pub id: i64,
    pub provider: String,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub completed_at: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticOutboxItem {
    pub id: i64,
    pub message_id: i64,
    pub recipients_masked: String,
    pub subject_present: bool,
    pub status: String,
    pub attempts: i64,
    pub last_error: String,
    pub queued_at: String,
    pub next_attempt_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticExport {
    pub generated_at: String,
    pub app_version: String,
    pub accounts: Vec<DiagnosticAccount>,
    pub unified_stats: MailStats,
    pub imap_mailboxes: Vec<ImapMailboxState>,
    pub sync_runs: Vec<SyncRun>,
    pub oauth_sessions: Vec<DiagnosticOAuthSession>,
    pub outbox: Vec<DiagnosticOutboxItem>,
}

pub type LocalBackupRow = BTreeMap<String, serde_json::Value>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalBackup {
    pub schema_version: i64,
    pub app_version: String,
    pub exported_at: String,
    pub tables: BTreeMap<String, Vec<LocalBackupRow>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalBackupSummary {
    pub path: String,
    pub exported_at: String,
    pub app_version: String,
    pub schema_version: i64,
    pub accounts: i64,
    pub messages: i64,
    pub labels: i64,
    pub rules: i64,
    pub outbox_items: i64,
    pub size_bytes: i64,
    pub credentials_included: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EndpointCheck {
    pub name: String,
    pub address: String,
    pub reachable: bool,
    pub latency_ms: Option<i64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionReport {
    pub account_email: String,
    pub checked_at: String,
    pub endpoints: Vec<EndpointCheck>,
    pub ready_for_credentials: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CredentialProtocolCheck {
    pub name: String,
    pub address: String,
    pub authenticated: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CredentialVerificationReport {
    pub account_email: String,
    pub checked_at: String,
    pub checks: Vec<CredentialProtocolCheck>,
    pub authenticated: bool,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImapFolderProbe {
    pub name: String,
    pub delimiter: String,
    pub attributes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImapProbeReport {
    pub account_email: String,
    pub checked_at: String,
    pub folder_count: i64,
    pub folders: Vec<ImapFolderProbe>,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImapMailboxState {
    pub id: i64,
    pub account_id: i64,
    pub account_email: String,
    pub remote_name: String,
    pub delimiter: String,
    pub attributes: String,
    pub local_role: String,
    pub local_folder_id: Option<i64>,
    pub local_folder_name: String,
    pub uid_validity: String,
    pub highest_uid: i64,
    pub lowest_uid: i64,
    pub history_complete: bool,
    pub history_last_sync_at: String,
    pub last_seen_at: String,
    pub last_sync_at: String,
}

#[derive(Debug, Clone)]
pub struct RemoteMessageHeader {
    pub remote_uid: i64,
    pub message_id: String,
    pub in_reply_to: String,
    pub references: String,
    pub subject: String,
    pub sender_name: String,
    pub sender_email: String,
    pub recipients: String,
    pub snippet: String,
    pub received_at: String,
    pub is_read: bool,
    pub is_starred: bool,
}

#[derive(Debug, Clone)]
pub struct ImapHeaderBatch {
    pub remote_name: String,
    pub uid_validity: String,
    pub highest_uid: i64,
    pub lowest_uid: i64,
    pub history_complete: bool,
    pub history_scanned: bool,
    pub cursor_reset: bool,
    pub headers: Vec<RemoteMessageHeader>,
}

#[derive(Debug, Clone)]
pub struct ImapFlagState {
    pub remote_uid: i64,
    pub is_read: bool,
    pub is_starred: bool,
}

#[derive(Debug, Clone)]
pub struct ImapFlagSnapshot {
    pub floor_uid: i64,
    pub complete: bool,
    pub states: Vec<ImapFlagState>,
}

#[derive(Debug, Clone)]
pub struct ImapFetchResult {
    pub headers: ImapHeaderBatch,
    pub flags: ImapFlagSnapshot,
}

#[derive(Debug, Clone)]
pub struct ImapReconcileResult {
    pub updated_messages: i64,
    pub removed_messages: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteActionReport {
    pub local_applied: bool,
    pub remote_attempted: bool,
    pub remote_applied: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreMessageReport {
    pub restored: Message,
    pub remote: RemoteActionReport,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrashActionReport {
    pub local_deleted_count: i64,
    pub remote_attempted_count: i64,
    pub remote_applied_count: i64,
    pub remote_skipped_count: i64,
    pub remote_failed_count: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderReadReport {
    pub updated_count: i64,
    pub remote_attempted_count: i64,
    pub remote_applied_count: i64,
    pub remote_skipped_count: i64,
    pub remote_failed_count: i64,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct RemoteMessageBody {
    pub body: String,
    pub sanitized_html: String,
    pub security_warnings: Vec<String>,
    pub snippet: String,
    pub has_attachments: bool,
    pub attachments: Vec<RemoteAttachmentMetadata>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncRun {
    pub id: i64,
    pub started_at: String,
    pub finished_at: String,
    pub status: String,
    pub scanned_folders: i64,
    pub imported_messages: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncSchedulePlan {
    pub max_accounts_per_batch: i64,
    pub total_accounts: i64,
    pub batch_accounts: Vec<Account>,
    pub delayed_accounts: Vec<Account>,
    pub strategy: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Contact {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub aliases: Vec<String>,
    pub vip: bool,
    pub message_count: i64,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContactMergeSuggestion {
    pub target: Contact,
    pub source: Contact,
    pub reason: String,
    pub shared_keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ContactInput {
    pub name: String,
    pub aliases: Vec<String>,
    pub vip: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ContactCreateInput {
    pub name: String,
    pub email: String,
    pub aliases: Vec<String>,
    pub vip: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContactImportSummary {
    pub path: String,
    pub total_cards: i64,
    pub created: i64,
    pub updated: i64,
    pub skipped: i64,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContactExportSummary {
    pub path: String,
    pub contacts: i64,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MailRule {
    pub id: i64,
    pub name: String,
    pub condition: String,
    pub action: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MailRuleInput {
    pub name: String,
    pub condition: String,
    pub action: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThreadSummary {
    pub thread_key: String,
    pub subject: String,
    pub message_count: i64,
    pub unread_count: i64,
    pub latest_at: String,
    pub participants: String,
    pub is_muted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutboxItem {
    pub id: i64,
    pub message_id: i64,
    pub recipients: String,
    pub subject: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: String,
    pub queued_at: String,
    pub next_attempt_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackgroundTask {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub source: String,
    pub status: String,
    pub message: String,
    pub created_at: String,
    pub started_at: String,
    pub finished_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BackgroundTaskInput {
    pub kind: String,
    pub source: String,
}

#[derive(Debug, Clone)]
pub struct OutboundMessage {
    pub id: i64,
    pub account_id: i64,
    pub sender_name: String,
    pub sender_email: String,
    pub reply_to: String,
    pub recipients: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub body: String,
    pub html_body: String,
    pub in_reply_to_header: String,
    pub references_header: String,
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawMessageInput {
    pub raw: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedMessagePreview {
    pub subject: String,
    pub from: String,
    pub to: String,
    pub body_preview: String,
    pub sanitized_html: String,
    pub attachment_count: i64,
    pub attachment_names: Vec<String>,
    pub warning_count: i64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CredentialInput {
    pub account_email: String,
    pub secret: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CredentialVerificationInput {
    pub account_id: Option<i64>,
    pub secret: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CredentialStatus {
    pub account_email: String,
    pub exists: bool,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OAuthStartInput {
    pub provider: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub login_hint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OAuthStartReport {
    pub session_id: i64,
    pub provider: String,
    pub authorization_url: String,
    pub redirect_uri: String,
    pub state: String,
    pub code_challenge: String,
    pub code_verifier_hint: String,
    pub scopes: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OAuthSession {
    pub id: i64,
    pub provider: String,
    pub authorization_url: String,
    pub redirect_uri: String,
    pub state: String,
    pub code_challenge: String,
    pub scopes: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub completed_at: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OAuthCallbackInput {
    pub state: String,
    pub code: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OAuthLocalCallbackInput {
    pub redirect_uri: String,
    pub timeout_seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct OAuthCallbackReport {
    pub session_id: i64,
    pub provider: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OAuthTokenExchangeInput {
    pub session_id: i64,
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OAuthTokenExchangeReport {
    pub session_id: i64,
    pub provider: String,
    pub status: String,
    pub expires_at: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OAuthRefreshInput {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OAuthRefreshReport {
    pub provider: String,
    pub status: String,
    pub expires_at: String,
    pub message: String,
}
