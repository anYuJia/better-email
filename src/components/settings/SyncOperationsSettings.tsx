import {
  FolderPlus,
  RefreshCw,
} from 'lucide-react';
import type {
  Account,
  BackgroundTaskKind,
  Folder,
  ImapMailboxState,
} from '../../app/types';
import { CustomSelect } from './accounts/CustomSelect';
import {
  SettingsButton,
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
  return (
    <div className="settings-sync-stack" data-settings-section="sync">
      <SettingsSection
        title="同步"
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
        {accountMailboxes.length > 0 && (
          <div className="mailbox-grid">
            {accountMailboxes.slice(0, 12).map((mailbox) => (
              <div
                className={mailbox.local_role === 'custom' ? 'mailbox-map-card custom' : 'mailbox-map-card'}
                data-imap-mailbox={mailbox.remote_name}
                key={mailbox.id}
              >
                <div className="mailbox-map-title">
                  <strong>{mailbox.remote_name}</strong>
                  <span className={mailbox.local_role === 'custom' && !mailbox.local_folder_id ? 'pending' : 'mapped'}>
                    {mailbox.local_role === 'custom'
                      ? mailbox.local_folder_id ? '已映射' : '未映射'
                      : '自动映射'}
                  </span>
                </div>
                {mailbox.local_role === 'custom' ? (
                  <div className="mailbox-map-controls">
                    <CustomSelect
                      dense
                      ariaLabel={`映射远端目录 ${mailbox.remote_name}`}
                      value={mailbox.local_folder_id ? String(mailbox.local_folder_id) : ''}
                      options={[
                        { value: '', label: '暂不同步' },
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
                    {!mailbox.local_folder_id && (
                      <SettingsButton
                        size="sm"
                        className="mailbox-create-map"
                        icon={<FolderPlus size={13} />}
                        onClick={() => onCreateAndMapImapMailbox(mailbox)}
                      >
                        新建同名
                      </SettingsButton>
                    )}
                  </div>
                ) : (
                  <span>{mailbox.local_role} · 最新 UID {mailbox.highest_uid || 0}</span>
                )}
                <small>
                  {mailbox.local_role === 'custom' && !mailbox.local_folder_name
                    ? '选择本地文件夹后加入同步'
                    : mailbox.history_complete
                      ? `历史已完整 · 最早 UID ${mailbox.lowest_uid || 0}`
                      : mailbox.lowest_uid > 0
                        ? `历史已回填至 UID ${mailbox.lowest_uid}`
                        : '等待首次同步'}
                </small>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

    </div>
  );
}
