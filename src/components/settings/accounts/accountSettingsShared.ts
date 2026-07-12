import type { IncomingProtocol } from '../../../app/types';

export type AccountDialogMode = 'details' | 'edit' | 'config' | 'delete';

export const syncModeOptions = [
  { value: 'manual', label: '手动获取' },
  { value: '1min', label: '每 1 分钟' },
  { value: '5min', label: '每 5 分钟' },
  { value: '15min', label: '每 15 分钟' },
  { value: '30min', label: '每 30 分钟' },
  { value: '60min', label: '每 60 分钟' },
];

export function protocolLabel(protocol: string) {
  return protocol === 'pop3' ? 'POP3' : 'IMAP';
}

export function protocolHint(protocol: IncomingProtocol | string) {
  return protocol === 'pop3'
    ? 'POP3 只同步收件箱，适合保留本地副本。'
    : 'IMAP 会同步远端文件夹和状态。';
}

export function syncModeLabel(syncMode: string) {
  const normalized = syncMode === 'push' ? '5min' : syncMode;
  return syncModeOptions.find((option) => option.value === normalized)?.label ?? '手动获取';
}

export function accountDialogTitle(mode: AccountDialogMode) {
  if (mode === 'details') return '账号详情';
  if (mode === 'edit') return '修改账号';
  if (mode === 'config') return '账号配置';
  return '删除账号';
}
