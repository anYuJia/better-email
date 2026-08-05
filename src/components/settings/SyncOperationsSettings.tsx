import {
  FolderPlus,
  History,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react';
import {
  canCancelOutboxItem,
  outboxStatusLabel,
  outboxTimingLabel,
} from '../../app/appConfig';
import type {
  ProviderWritebackValidationProgress,
  ProviderWritebackValidationStepId,
  ProviderWriteValidationStatus,
} from '../../app/providerWriteValidation';
import type {
  Account,
  BackgroundTaskKind,
  Folder,
  ImapMailboxState,
  ImapProbeReport,
  OutboxItem,
  SyncRun,
  SyncSchedulePlan,
} from '../../app/types';
import { formatDate } from '../../mailUtils';
import ProviderWriteValidationSettings from './ProviderWriteValidationSettings';
import { CustomSelect } from './accounts/CustomSelect';
import {
  SettingsBadge,
  SettingsButton,
  SettingsEmptyState,
  SettingsSection,
} from './shared';

import { devMode } from './settingsNavigation';

type SyncOperationsSettingsProps = {
  accountForm: Account;
  imapProbe: ImapProbeReport | null;
  syncSchedulePlan: SyncSchedulePlan | null;
  imapMailboxes: ImapMailboxState[];
  folders: Folder[];
  syncRuns: SyncRun[];
  outbox: OutboxItem[];
  writeValidationStatus: ProviderWriteValidationStatus | null;
  writeValidationLoading: boolean;
  writebackValidationProgress: ProviderWritebackValidationProgress | null;
  onDiscoverImapFolders: () => void;
  onPrepareWriteValidation: () => void;
  onRefreshWriteValidation: () => void;
  onLocateWriteValidation: (role: 'sent' | 'inbox') => void;
  onRunWritebackValidationStep: (step: ProviderWritebackValidationStepId) => void;
  onResetWritebackValidation: () => void;
  onRunSyncDryRun: () => void;
  onSyncHistory: () => void;
  onMapImapMailbox: (mailbox: ImapMailboxState, folderId: number | null) => void;
  onCreateAndMapImapMailbox: (mailbox: ImapMailboxState) => void;
  onEnqueueBackgroundTask: (kind: BackgroundTaskKind, source: 'manual' | 'timer') => void;
  onCancelOutboxItem: (item: OutboxItem) => void;
};

export default function SyncOperationsSettings({
  accountForm,
  imapProbe,
  syncSchedulePlan,
  imapMailboxes,
  folders,
  syncRuns,
  outbox,
  writeValidationStatus,
  writeValidationLoading,
  writebackValidationProgress,
  onDiscoverImapFolders,
  onPrepareWriteValidation,
  onRefreshWriteValidation,
  onLocateWriteValidation,
  onRunWritebackValidationStep,
  onResetWritebackValidation,
  onRunSyncDryRun,
  onSyncHistory,
  onMapImapMailbox,
  onCreateAndMapImapMailbox,
  onEnqueueBackgroundTask,
  onCancelOutboxItem,
}: SyncOperationsSettingsProps) {
  const accountMailboxes = imapMailboxes.filter((mailbox) => mailbox.account_id === accountForm.id);
  const customFolders = folders.filter(
    (folder) => folder.account_id === accountForm.id && folder.role.startsWith('custom:'),
  );
  const pendingHistoryCount = accountMailboxes.filter(
    (mailbox) => (mailbox.local_role !== 'custom' || mailbox.local_folder_id) && !mailbox.history_complete,
  ).length;

  return (
    <div className="settings-sync-stack" data-settings-section="sync">
      <SettingsSection
        title="同步与发信高级工具"
        description={devMode ? '回写验收、IMAP 发现、同步演练和发件箱队列' : '管理邮件同步状态与连接'}
        badge={<SettingsBadge tone="neutral">{syncRuns.length ? `${syncRuns.length} 次` : '待运行'}</SettingsBadge>}
      />

      {devMode && (
        <ProviderWriteValidationSettings
          status={writeValidationStatus}
          loading={writeValidationLoading}
          writebackProgress={writebackValidationProgress}
          onPrepare={onPrepareWriteValidation}
          onRefresh={onRefreshWriteValidation}
          onLocate={onLocateWriteValidation}
          onRunWritebackStep={onRunWritebackValidationStep}
          onResetWriteback={onResetWritebackValidation}
        />
      )}

      {devMode && (
        <SettingsSection
          title="IMAP 文件夹发现"
          description="读取远端邮箱文件夹 structure 并映射本地角色"
          actions={
            <SettingsButton icon={<Search size={14} />} onClick={onDiscoverImapFolders}>
              发现文件夹
            </SettingsButton>
          }
        >
          {!imapProbe ? (
            <SettingsEmptyState>保存本地凭据后，可真实登录 IMAP 并读取远端文件夹列表。</SettingsEmptyState>
          ) : (
            <>
              <div className={imapProbe.status === 'ok' ? 'st-data-row ok' : 'st-data-row warn'}>
                <span>{imapProbe.status}</span>
                <em>{imapProbe.account_email}</em>
                <small>{imapProbe.folder_count} 个</small>
                <p>{imapProbe.message}</p>
              </div>
              <div className="settings-folder-grid">
                {imapProbe.folders.slice(0, 12).map((folder) => (
                  <div className="st-data-row" key={folder.name}>
                    <span>{folder.name}</span>
                    <em>{folder.delimiter || 'flat'}</em>
                    <small>{folder.attributes.join(', ')}</small>
                  </div>
                ))}
              </div>
            </>
          )}
        </SettingsSection>
      )}

      <SettingsSection
        title="同步设置"
        description={devMode ? '检查调度批次、文件夹状态和增量同步结果' : '同步状态与手动刷新邮件头'}
        actions={
          <div className="st-actions">
            {devMode && <SettingsButton onClick={onRunSyncDryRun}>演练</SettingsButton>}
            {devMode && (
              <SettingsButton
                disabled={pendingHistoryCount === 0}
                title={pendingHistoryCount === 0 ? '当前账号历史邮件已回填完成' : `为 ${pendingHistoryCount} 个目录各回填一页`}
                icon={<History size={14} />}
                onClick={onSyncHistory}
              >
                回填一页
              </SettingsButton>
            )}
            <SettingsButton variant="primary" icon={<RefreshCw size={14} />} onClick={() => onEnqueueBackgroundTask('sync', 'manual')}>
              同步邮件头
            </SettingsButton>
          </div>
        }
      >
        {syncSchedulePlan && (
          <div className="sync-schedule-card">
            <div>
              <span>同步调度与限流</span>
              <strong>
                本轮 {syncSchedulePlan.batch_accounts.length}/{syncSchedulePlan.total_accounts || 0} 个账号
              </strong>
            </div>
            <div className="sync-schedule-metrics">
              <span>每轮最多 {syncSchedulePlan.max_accounts_per_batch} 个账号</span>
              <span>
                下一批 {syncSchedulePlan.delayed_accounts.length
                  ? `${syncSchedulePlan.delayed_accounts.length} 个账号`
                  : '无等待'}
              </span>
            </div>
            <p>{syncSchedulePlan.strategy}</p>
            <div className="sync-account-strip">
              {syncSchedulePlan.batch_accounts.map((syncAccount) => (
                <span className="active" key={syncAccount.id}>
                  {syncAccount.display_name || syncAccount.email}
                </span>
              ))}
              {syncSchedulePlan.delayed_accounts.slice(0, 3).map((syncAccount) => (
                <span key={syncAccount.id}>下轮 · {syncAccount.display_name || syncAccount.email}</span>
              ))}
            </div>
          </div>
        )}
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
        {syncRuns.length === 0 ? (
          <SettingsEmptyState>还没有同步运行记录。</SettingsEmptyState>
        ) : (
          <div className="st-list">
            {syncRuns.map((run) => (
              <div className={run.imported_messages > 0 ? 'st-data-row ok' : 'st-data-row'} key={run.id}>
                <span>{run.status}</span>
                <em>扫描 {run.scanned_folders} 个文件夹 · 新增 {run.imported_messages} 封</em>
                <small>{formatDate(run.started_at)}</small>
                <p>{run.message}</p>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="发件箱队列"
        description="查看排队、定时发送、重试和撤回状态"
        actions={devMode ? (
          <div className="st-actions">
            <SettingsButton onClick={() => onEnqueueBackgroundTask('outbox-dry-run', 'manual')}>
              发送演练
            </SettingsButton>
            <SettingsButton variant="primary" icon={<Send size={14} />} onClick={() => onEnqueueBackgroundTask('outbox-smtp', 'manual')}>
              真实发送
            </SettingsButton>
          </div>
        ) : undefined}
      >
        {outbox.length === 0 ? (
          <SettingsEmptyState>发件箱当前为空。</SettingsEmptyState>
        ) : (
          <div className="st-list">
            {outbox.map((item) => (
              <div className="st-data-row" key={item.id}>
                <span>{outboxStatusLabel(item.status)}</span>
                <em>{item.recipients}</em>
                <small>{item.attempts} 次</small>
                <p>
                  {item.subject || '(无主题)'}
                  {outboxTimingLabel(item) ? ` · ${outboxTimingLabel(item)}` : ''}
                  {item.last_error ? ` · ${item.last_error}` : ''}
                </p>
                {canCancelOutboxItem(item.status) && (
                  <SettingsButton size="sm" variant="danger-secondary" onClick={() => onCancelOutboxItem(item)}>
                    撤回
                  </SettingsButton>
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
