import {
  FolderPlus,
  RefreshCw,
} from 'lucide-react';
import { imapMailboxDisplayName } from '../../app/imapMailboxDisplay';
import type {
  Account,
  BackgroundTaskKind,
  Folder,
  ImapMailboxState,
} from '../../app/types';
import { CustomSelect } from './accounts/CustomSelect';
import {
  SettingsButton,
  SettingsEmptyState,
  SettingsSection,
} from './shared';

type SyncOperationsSettingsProps = {
  accountForm: Account;
  imapMailboxes: ImapMailboxState[];
  folders: Folder[];
  onMapImapMailbox: (mailbox: ImapMailboxState, folderId: number | null) => void;
  onCreateAndMapImapMailbox: (mailbox: ImapMailboxState) => void;
  onEnqueueBackgroundTask: (kind: BackgroundTaskKind, source: 'manual' | 'timer') => void;
};

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
  accountForm,
  imapMailboxes,
  folders,
  onMapImapMailbox,
  onCreateAndMapImapMailbox,
  onEnqueueBackgroundTask,
}: SyncOperationsSettingsProps) {
  const accountMailboxes = imapMailboxes.filter((mailbox) => mailbox.account_id === accountForm.id);
  const customFolders = folders.filter(
    (folder) => folder.account_id === accountForm.id && folder.role.startsWith('custom:'),
  );
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

  function renderStatus(mailbox: ImapMailboxState) {
    const status = mailboxSyncState(mailbox);
    return (
      <span className="settings-mailbox-status" data-state={status.state}>
        {status.label}
      </span>
    );
  }

  return (
    <div className="settings-sync-stack" data-settings-section="sync">
      <SettingsSection
        title="文件夹"
        description="查看文件夹状态并手动刷新邮件。"
        actions={
          <div className="st-actions">
            <SettingsButton variant="primary" icon={<RefreshCw size={14} />} onClick={() => onEnqueueBackgroundTask('sync', 'manual')}>
              同步邮件
            </SettingsButton>
          </div>
        }
        dataSection="sync"
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

    </div>
  );
}
