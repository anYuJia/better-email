import type { InvokeArgs, MockCommandHandler } from './types';
import { now } from './fixtures';
import {
  account,
  mockAccounts,
  identities,
  folders,
  messages,
  mockImapMailboxes,
  oauthSessions,
  createMockAccount,
  setDefaultMockAccount,
  removeMockAccount,
  deleteMockAccount,
  mockSavedSecretEmails,
  updateMockAccountSettings,
  createMockCustomFolder,
  renameMockCustomFolder,
  deleteMockCustomFolder,
  discoverMockImapMailboxes,
  mapMockImapMailbox,
  startMockOAuth2Pkce,
  completeMockOAuth2Callback,
  waitForMockOAuth2Callback,
  exchangeMockOAuth2Token,
  upsertMockIdentity,
  deleteMockIdentity,
} from './state';

function testConnection(args?: InvokeArgs) {
  const targetAccount = mockAccounts.find((item) => item.id === Number(args?.accountId)) ?? account;
  const incomingName = targetAccount.incoming_protocol === 'pop3' ? 'POP3' : 'IMAP';
  return {
    account_email: targetAccount.email,
    checked_at: now,
    ready_for_credentials: true,
    endpoints: [
      { name: incomingName, address: targetAccount.imap_host, reachable: true, latency_ms: 12, message: 'mock ok' },
      { name: 'SMTP', address: targetAccount.smtp_host, reachable: true, latency_ms: 14, message: 'mock ok' },
    ],
  };
}

function verifyAccountCredentials(args?: InvokeArgs) {
  const targetAccount = mockAccounts.find((item) => item.id === Number(args?.accountId)) ?? account;
  const incomingName = targetAccount.incoming_protocol === 'pop3' ? 'POP3' : 'IMAP';
  return {
    account_email: targetAccount.email,
    checked_at: now,
    authenticated: true,
    status: 'ok',
    message: `${incomingName} 与 SMTP 登录验证通过，未发送任何邮件。`,
    checks: [
      { name: incomingName, address: targetAccount.imap_host, authenticated: true, message: `${incomingName} 登录认证成功。` },
      { name: 'SMTP', address: targetAccount.smtp_host, authenticated: true, message: 'SMTP 登录认证成功。' },
    ],
  };
}

function verifyAccountCredentialsWithSecret(args?: InvokeArgs) {
  const input = (args?.input ?? {}) as { account_id?: number; secret?: string };
  const targetAccount = mockAccounts.find((item) => item.id === Number(input.account_id)) ?? account;
  const incomingName = targetAccount.incoming_protocol === 'pop3' ? 'POP3' : 'IMAP';
  const hasSecret = Boolean(String(input.secret ?? '').trim());
  return {
    account_email: targetAccount.email,
    checked_at: now,
    authenticated: hasSecret,
    status: hasSecret ? 'ok' : 'credential_error',
    message: hasSecret
      ? `${incomingName} 与 SMTP 登录验证通过，未发送任何邮件。`
      : '请输入授权码或密码后再验证。',
    checks: [
      {
        name: incomingName,
        address: targetAccount.imap_host,
        authenticated: hasSecret,
        message: hasSecret ? `${incomingName} 登录认证成功。` : '未发起登录：缺少授权码。',
      },
      {
        name: 'SMTP',
        address: targetAccount.smtp_host,
        authenticated: hasSecret,
        message: hasSecret ? 'SMTP 登录认证成功。' : '未发起登录：缺少授权码。',
      },
    ],
  };
}

export const handlers: Record<string, MockCommandHandler> = {
  'list_accounts': () => mockAccounts,
  'get_account': (args) => {
    if (mockAccounts.length === 0) return null;
    return Number(args?.accountId ?? 0) > 0
      ? mockAccounts.find((item) => item.id === Number(args?.accountId)) ?? account
      : account;
  },
  'create_account': createMockAccount,
  'store_account_secret': (args) => {
    const input = (args?.input ?? {}) as { account_email?: string; secret?: string };
    const email = String(input.account_email ?? '').trim().toLowerCase();
    if (email) mockSavedSecretEmails.add(email);
    return {
      exists: true,
      message: '本机凭据已安全保存。',
    };
  },
  'check_account_secret': (args) => {
    const email = String(args?.accountEmail ?? '').trim().toLowerCase();
    const exists = mockSavedSecretEmails.has(email);
    return {
      account_email: email,
      exists,
      status: exists ? 'exists' : 'not_found',
      message: exists ? '本地应用数据中存在该账号授权码。' : '未保存该账号授权码。',
    };
  },
  'set_default_account': setDefaultMockAccount,
  'delete_account_secret': (args) => {
    const email = String(args?.accountEmail ?? '').trim().toLowerCase();
    // Simulating local SQLite credential deletion failure for a specific mock email name to test failure path
    if (email.startsWith('fail')) {
      return {
        account_email: email,
        exists: true,
        status: 'failed',
        message: '本地数据库写入拒绝，删除凭据失败。',
      };
    }
    mockSavedSecretEmails.delete(email);
    return {
      account_email: email,
      exists: false,
      status: 'deleted',
      message: '本地凭据已删除。',
    };
  },
  'remove_account': removeMockAccount,
  'delete_account': deleteMockAccount,
  'update_account_settings': updateMockAccountSettings,
  'list_folders': (args) => folders.filter((folder) => {
    const accountId = Number(args?.accountId ?? 0);
    if (accountId <= 0) return folder.is_virtual || String(folder.role).startsWith('custom:');
    return !folder.is_virtual && folder.account_id === accountId;
  }).map((folder) => ({
    ...folder,
    unread_count: messages.filter((message) => {
      if (message.is_read) return false;
      return folder.is_virtual
        ? message.folder_role === folder.role
        : message.folder_id === folder.id;
    }).length,
  })),
  'create_custom_folder': createMockCustomFolder,
  'rename_custom_folder': renameMockCustomFolder,
  'delete_custom_folder': deleteMockCustomFolder,
  'list_identities': () => identities,
  'upsert_identity': upsertMockIdentity,
  'delete_identity': deleteMockIdentity,
  'test_connection': testConnection,
  'verify_account_credentials': verifyAccountCredentials,
  'verify_account_credentials_with_secret': verifyAccountCredentialsWithSecret,
  'discover_imap_folders': discoverMockImapMailboxes,
  'list_imap_mailboxes': () => mockImapMailboxes,
  'map_imap_mailbox': mapMockImapMailbox,
  'list_oauth_sessions': () => oauthSessions,
  'start_oauth2_pkce': startMockOAuth2Pkce,
  'complete_oauth2_callback': completeMockOAuth2Callback,
  'wait_for_oauth2_callback': waitForMockOAuth2Callback,
  'exchange_oauth2_token': exchangeMockOAuth2Token,
  'refresh_oauth2_token': () => {
    const provider = oauthSessions[0]?.provider ?? account.provider;
    return {
      provider,
      status: 'refreshed',
      expires_at: new Date(Date.parse(now) + 7_200_000).toISOString(),
      message: 'UI smoke mock OAuth2 Token 已刷新。',
    };
  },
};
