import {
  FolderPlus,
  RefreshCw,
} from 'lucide-react';
import { imapMailboxDisplayName } from '../../app/imapMailboxDisplay';
import {
  MIXED_ACCOUNT_SETTING_VALUE,
} from '../../app/accountScopedSettings';
import type {
  Account,
  AccountScope,
  BackgroundTaskKind,
  Folder,
  ImapMailboxState,
} from '../../app/types';
import type { SettingsAccountValueChange, SettingsAccountValues } from './accountScopeTypes';
import AccountScopeRequired from './shared/AccountScopeRequired';
import { CustomSelect } from './accounts/CustomSelect';
import { syncModeOptions } from './accounts/accountSettingsShared';
import {
  SettingsButton,
  SettingsEmptyState,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from './shared';

type SyncOperationsSettingsProps = {
  accountScope: AccountScope;
  accounts: Account[];
  accountForm: Account | null;
  accountValues: SettingsAccountValues;
  imapMailboxes: ImapMailboxState[];
  folders: Folder[];
  onAccountValueChange: SettingsAccountValueChange;
  onAccountFormChange: (account: Account) => void;
  onMapImapMailbox: (mailbox: ImapMailboxState, folderId: number | null) => void;
  onCreateAndMapImapMailbox: (mailbox: ImapMailboxState) => void;
  onEnqueueBackgroundTask: (kind: BackgroundTaskKind, source: 'manual' | 'timer') => void;
};

const mixedSyncOption = { value: MIXED_ACCOUNT_SETTING_VALUE, label: '多个值' };

const systemRoleOrder = new Map([
  ['inbox', 0],
  ['sent', 1],
  ['drafts', 2],
  ['archive', 3],
  ['spam', 4],
  ['trash', 5],
]);

function mailboxSyncState(mailbox: ImapMailboxState) {
  const mapped = mailbox.local_role !== 'custom' || Boolean(mailbox.local_folder_id);
  if (!mapped) return { label: '未同步', state: 'idle' } as const;
  if (mailbox.history_complete) return { label: '已同步', state: 'success' } as const;
  if (mailbox.lowest_uid > 0) return { label: '同步中', state: 'progress' } as const;
  return { label: '等待同步', state: 'pending' } as const;
}

function MailboxName({ mailbox }: { mailbox: ImapMailboxState }) {
  const displayName = imapMailboxDisplayName(mailbox);
  return (
    <span
      className="settings-mailbox-name"
      title={displayName === mailbox.remote_name ? undefined : `服务器目录：${mailbox.remote_name}`}
    >
      {displayName}
    </span>
  );
}

export default function SyncOperationsSettings({
  accountScope,
  accounts,
  accountForm,
  accountValues,
  imapMailboxes,
  folders,
  onAccountValueChange,
  onAccountFormChange,
  onMapImapMailbox,
  onCreateAndMapImapMailbox,
  onEnqueueBackgroundTask,
}: SyncOperationsSettingsProps) {
  if (accounts.length === 0 || (accountScope !== 'all' && !accountForm)) {
    return (
      <AccountScopeRequired
        accountScope={accountScope}
        accounts={accounts}
        onSelectAccount={onAccountFormChange}
        title="请先添加邮箱账号"
        description="同步设置需要绑定邮箱账号。请从下方选择账号或使用顶部的邮箱范围选择器继续。"
      />
    );
  }

  const accountMailboxes = accountForm
    ? imapMailboxes.filter((mailbox) => mailbox.account_id === accountForm.id)
    : [];
  const customFolders = accountForm
    ? folders.filter(
      (folder) => folder.account_id === accountForm.id && folder.role.startsWith('custom:'),
    )
    : [];
  const systemMailboxes = accountMailboxes
    .filter((mailbox) => mailbox.local_role !== 'custom')
    .sort((left, right) => (
      (systemRoleOrder.get(left.local_role) ?? Number.MAX_SAFE_INTEGER)
      - (systemRoleOrder.get(right.local_role) ?? Number.MAX_SAFE_INTEGER)
    ));
  const customMailboxes = accountMailboxes
    .filter((mailbox) => mailbox.local_role === 'custom')
    .sort((left, right) => (
      imapMailboxDisplayName(left).localeCompare(imapMailboxDisplayName(right), 'zh-CN')
    ));
  const syncModeValue = accountScope === 'all' ? accountValues.sync_mode : accountForm?.sync_mode;
  const autoDownloadValue = accountScope === 'all'
    ? accountValues.auto_download_attachments
    : accountForm?.auto_download_attachments;

  function renderStatus(mailbox: ImapMailboxState) {
    const status = mailboxSyncState(mailbox);
    return (
      <span className="settings-mailbox-status" data-state={status.state}>
        {status.label}
      </span>
    );
  }

  function updateSyncMode(value: string) {
    if (value === MIXED_ACCOUNT_SETTING_VALUE) return;
    if (accountScope === 'all') {
      onAccountValueChange('sync_mode', value);
    } else if (accountForm) {
      onAccountFormChange({ ...accountForm, sync_mode: value });
    }
  }

  function updateAutoDownload(checked: boolean) {
    if (accountScope === 'all') {
      onAccountValueChange('auto_download_attachments', checked);
    } else if (accountForm) {
      onAccountFormChange({ ...accountForm, auto_download_attachments: checked });
    }
  }

  return (
    <div className="settings-sync-stack" data-settings-section="sync">
      <SettingsSection
        title="同步偏好"
        description={accountScope === 'all' ? '只修改你主动调整的字段，保存后应用到所有邮箱账号。' : '控制当前账号的后台检查与附件处理。'}
        dataSection="sync-preferences"
      >
        <SettingsRow
          title="获取新邮件"
          description={syncModeValue === MIXED_ACCOUNT_SETTING_VALUE
            ? '不同邮箱账号当前设置不同。选择一个频率后会统一应用。'
            : '控制此账号的后台检查频率。'}
          control={(
            <CustomSelect
              dense
              ariaLabel="获取新邮件"
              value={typeof syncModeValue === 'string' ? syncModeValue : MIXED_ACCOUNT_SETTING_VALUE}
              options={[
                ...(syncModeValue === MIXED_ACCOUNT_SETTING_VALUE ? [mixedSyncOption] : []),
                ...syncModeOptions,
              ]}
              onChange={updateSyncMode}
            />
          )}
        />
        <SettingsSwitch
          label="自动下载新邮件附件"
          description={autoDownloadValue === MIXED_ACCOUNT_SETTING_VALUE
            ? '不同邮箱账号当前设置不同。修改后会统一应用到所有支持的账号。'
            : '新附件会保存到默认下载位置，邮件正文仍按需加载。'}
          checked={autoDownloadValue === true}
          indeterminate={autoDownloadValue === MIXED_ACCOUNT_SETTING_VALUE}
          onChange={updateAutoDownload}
        />
      </SettingsSection>

      {accountScope === 'all' ? (
        <SettingsSection
          title="文件夹映射"
          description="文件夹属于具体邮箱账号，不能在统一范围编辑。"
          dataSection="sync-mailboxes"
        >
          <SettingsEmptyState>
            请使用顶部的邮箱范围选择器选择具体账号后查看和管理远端文件夹。
          </SettingsEmptyState>
        </SettingsSection>
      ) : (
        <SettingsSection
          title="文件夹"
          description="查看文件夹状态并手动刷新邮件。"
          actions={(
            <div className="st-actions">
              <SettingsButton variant="primary" icon={<RefreshCw size={14} />} onClick={() => onEnqueueBackgroundTask('sync', 'manual')}>
                同步邮件
              </SettingsButton>
            </div>
          )}
          dataSection="sync-mailboxes"
        >
          {accountMailboxes.length === 0 ? (
            <SettingsEmptyState>还没有发现远端文件夹。请先确认账号连接，再同步邮件。</SettingsEmptyState>
          ) : (
            <div className="settings-mailbox-groups">
              {systemMailboxes.length > 0 && (
                <section className="settings-mailbox-group" aria-labelledby="settings-system-mailboxes-title">
                  <header className="settings-mailbox-group-header">
                    <strong id="settings-system-mailboxes-title">系统文件夹</strong>
                    <small>收件箱、已发送等目录由 Better Email 自动匹配。</small>
                  </header>
                  <div className="settings-mailbox-list">
                    {systemMailboxes.map((mailbox) => (
                      <div
                        className="settings-mailbox-row is-system"
                        data-imap-mailbox={mailbox.remote_name}
                        key={mailbox.id}
                      >
                        <MailboxName mailbox={mailbox} />
                        {renderStatus(mailbox)}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {customMailboxes.length > 0 && (
                <section className="settings-mailbox-group" aria-labelledby="settings-custom-mailboxes-title">
                  <header className="settings-mailbox-group-header">
                    <strong id="settings-custom-mailboxes-title">其他文件夹</strong>
                    <small>
                      {customFolders.length > 0
                        ? '选择对应的本地文件夹；不需要的目录可以保持不同步。'
                        : '需要同步的目录可直接创建对应的本地文件夹。'}
                    </small>
                  </header>
                  <div className="settings-mailbox-list">
                    {customMailboxes.map((mailbox) => (
                      <div
                        className={`settings-mailbox-row is-custom${customFolders.length === 0 ? ' has-create-only' : ''}`}
                        data-imap-mailbox={mailbox.remote_name}
                        key={mailbox.id}
                      >
                        <MailboxName mailbox={mailbox} />
                        <div className="settings-mailbox-map-actions">
                          {customFolders.length > 0 && (
                            <CustomSelect
                              dense
                              className="settings-mailbox-target-select"
                              ariaLabel={`选择 ${imapMailboxDisplayName(mailbox)} 的本地文件夹`}
                              value={mailbox.local_folder_id ? String(mailbox.local_folder_id) : ''}
                              options={[
                                { value: '', label: '不进行同步' },
                                ...customFolders.map((folder) => ({
                                  value: String(folder.id),
                                  label: folder.name,
                                })),
                              ]}
                              onChange={(nextValue) => {
                                const nextFolderId = Number(nextValue);
                                onMapImapMailbox(mailbox, nextFolderId > 0 ? nextFolderId : null);
                              }}
                            />
                          )}
                          {!mailbox.local_folder_id && (
                            <SettingsButton
                              size="sm"
                              className="settings-mailbox-create-map"
                              icon={<FolderPlus size={13} />}
                              onClick={() => onCreateAndMapImapMailbox(mailbox)}
                            >
                              创建并同步
                            </SettingsButton>
                          )}
                        </div>
                        {renderStatus(mailbox)}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </SettingsSection>
      )}
    </div>
  );
}
