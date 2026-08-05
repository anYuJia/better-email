import type { IncomingProtocol } from './mailbox';

export type ProviderVerificationStatus = 'untested' | 'passed' | 'partial' | 'failed';

export type Account = {
  id: number;
  email: string;
  display_name: string;
  provider: string;
  imap_host: string;
  smtp_host: string;
  incoming_protocol: IncomingProtocol;
  auth_type: string;
  sync_mode: string;
  remote_images_allowed: boolean;
  signature: string;
  cross_account_risk_warning: boolean;
  block_external_mailboxes: boolean;
  intercept_https_links: boolean;
  is_default: boolean;
};


export type AccountCreateInput = Omit<Account, 'id' | 'is_default'>;


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


export type CredentialStatus = {
  account_email: string;
  exists: boolean;
  status: string;
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

