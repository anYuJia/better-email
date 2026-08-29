import type {
  AccountCreateInput,
  ContactCreateInput,
  FilterMode,
  OutboxItem,
  ProviderVerificationStatus,
  SearchScope,
} from './types';
import { formatDate } from '../mailUtils';

export function normalizeContactAliases(value: string): string[] {
  return [...new Set(value
    .split(/[;,\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}

export function isValidEmailAddress(value: string): boolean {
  const parts = value.trim().split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && domain.includes('.') && !value.includes(' ');
}

export type ContactAliasIssues = {
  invalid: string[];
  duplicatesWithin: string[];
  conflictingPrimary: string[];
  takenByOther: string[];
};

export const emptyContactAliasIssues: ContactAliasIssues = {
  invalid: [],
  duplicatesWithin: [],
  conflictingPrimary: [],
  takenByOther: [],
};

export function validateContactAliases(
  raw: string,
  primaryEmail: string,
  takenByOther: ReadonlySet<string>,
): ContactAliasIssues {
  const primary = primaryEmail.trim().toLowerCase();
  const unique = [...new Set(raw
    .split(/[;,\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
  const invalid: string[] = [];
  const conflictingPrimary: string[] = [];
  const taken: string[] = [];
  for (const item of unique) {
    if (!isValidEmailAddress(item)) {
      invalid.push(item);
    } else if (item === primary) {
      conflictingPrimary.push(item);
    } else if (takenByOther.has(item)) {
      taken.push(item);
    }
  }
  const seen = new Set<string>();
  const duplicatesWithin: string[] = [];
  for (const item of unique) {
    if (seen.has(item)) duplicatesWithin.push(item);
    seen.add(item);
  }
  return { invalid, duplicatesWithin, conflictingPrimary, takenByOther: taken };
}

export function formatContactAliasIssues(issues: ContactAliasIssues): string {
  const parts: string[] = [];
  if (issues.invalid.length > 0) parts.push(`格式无效：${issues.invalid.join('、')}`);
  if (issues.duplicatesWithin.length > 0) parts.push(`重复输入：${issues.duplicatesWithin.join('、')}`);
  if (issues.conflictingPrimary.length > 0) parts.push(`与主邮箱相同（将被忽略）：${issues.conflictingPrimary.join('、')}`);
  if (issues.takenByOther.length > 0) parts.push(`已被其他联系人使用：${issues.takenByOther.join('、')}`);
  return parts.join('；');
}

export const emptyContactForm: ContactCreateInput = {
  name: '',
  email: '',
  aliases: [],
  vip: false,
};


export const shortcutGroups = [
  {
    title: '导航',
    items: [
      { keys: ['⌘/Ctrl', 'K'], label: '快速搜索' },
      { keys: ['⌘/Ctrl', 'A'], label: '选择当前列表全部邮件' },
      { keys: ['J', '↓'], label: '下一封' },
      { keys: ['K', '↑'], label: '上一封' },
      { keys: ['Esc'], label: '关闭弹窗 / 取消选择' },
    ],
  },
  {
    title: '写信',
    items: [
      { keys: ['C'], label: '写邮件' },
      { keys: ['R'], label: '回复' },
      { keys: ['⇧', 'R'], label: '回复全部' },
      { keys: ['F'], label: '转发' },
    ],
  },
  {
    title: '处理邮件',
    items: [
      { keys: ['⌘/Ctrl', 'Z'], label: '撤销上一步邮件操作' },
      { keys: ['S'], label: '星标' },
      { keys: ['M'], label: '已读/未读' },
      { keys: ['E'], label: '归档' },
      { keys: ['Delete'], label: '移到废纸篓' },
    ],
  },
];

export const filters: { id: FilterMode; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'starred', label: '星标' },
  { id: 'attachments', label: '附件' },
];

export const messagePageSize = 40;

export const searchShortcuts = [
  { label: '未读', query: 'is:unread' },
  { label: '附件名', query: 'filename:' },
  { label: '发件人', query: 'from:' },
  { label: '邮箱', query: 'account:' },
];

export const searchScopeOptions: { id: SearchScope; label: string; shortLabel: string }[] = [
  { id: 'folder', label: '当前文件夹', shortLabel: '文件夹' },
  { id: 'account', label: '当前账号', shortLabel: '账号' },
  { id: 'all', label: '全部账号', shortLabel: '全部' },
];

export const emptyAccountCreateForm: AccountCreateInput = {
  email: '',
  display_name: '',
  provider: 'Custom',
  imap_host: '',
  smtp_host: '',
  incoming_protocol: 'imap',
  auth_type: 'password',
  sync_mode: '5min',
  remote_images_allowed: false,
  cross_account_risk_warning: true,
  block_external_mailboxes: false,
  intercept_https_links: true,
  auto_download_attachments: false,
  fetch_history_attachments: false,
  warn_external_senders: false,
  signature: '',
};

export function providerVerificationLabel(status: ProviderVerificationStatus): string {
  if (status === 'passed') return '通过';
  if (status === 'partial') return '部分通过';
  if (status === 'failed') return '失败';
  return '未验证';
}

export function outboxStatusLabel(status: string): string {
  if (status === 'scheduled') return '定时发送';
  if (status === 'queued') return '排队中';
  if (status === 'retry') return '等待重试';
  if (status === 'failed') return '需要处理';
  if (status === 'sent_remote_pending') return '已发送 · 留档待重试';
  if (status === 'sent') return '已发送';
  if (status === 'sent_dry_run') return '演练完成';
  if (status === 'cancelled') return '已撤回';
  return status;
}

export function outboxTimingLabel(item: OutboxItem): string {
  if (item.status === 'scheduled' && item.next_attempt_at) return `定时发送 ${formatDate(item.next_attempt_at)}`;
  if (item.status === 'retry' && item.next_attempt_at) return `下次重试 ${formatDate(item.next_attempt_at)}`;
  if (item.status === 'failed') return '已暂停自动发送';
  if (item.status === 'sent_remote_pending' && item.next_attempt_at) {
    return `远端留档重试 ${formatDate(item.next_attempt_at)}`;
  }
  if (item.queued_at) return `入队 ${formatDate(item.queued_at)}`;
  return '';
}

export function canCancelOutboxItem(status: string): boolean {
  return ['queued', 'scheduled', 'retry', 'failed'].includes(status);
}
