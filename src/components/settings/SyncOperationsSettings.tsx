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
import './data-settings.css';

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
    <details className="settings-disclosure" data-settings-section="sync" open>
      <summary>
        <span>
          <strong>同步与发信高级工具</strong>
          <em>回写验收、IMAP 发现、同步演练和发件箱队列</em>
        </span>
        <b>{syncRuns.length ? `${syncRuns.length} 次` : '待运行'}</b>
      </summary>

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

      <section className="tool-panel settings-imap-discovery">
        <header className="tool-header">
          <span>
            <strong>IMAP 文件夹发现</strong>
            <small>读取远端邮箱文件夹结构并映射本地角色</small>
          </span>
          <button type="button" onClick={onDiscoverImapFolders}>
            <Search size={14} />
            发现文件夹
          </button>
        </header>
        {!imapProbe ? (
          <p className="settings-empty-state">保存系统凭据后，可真实登录 IMAP 并读取远端文件夹列表。</p>
        ) : (
          <>
            <div className={imapProbe.status === 'ok' ? 'tool-row ok' : 'tool-row warn'}>
              <span>{imapProbe.status}</span>
              <em>{imapProbe.account_email}</em>
              <small>{imapProbe.folder_count} 个</small>
              <p>{imapProbe.message}</p>
            </div>
            <div className="settings-folder-grid">
              {imapProbe.folders.slice(0, 12).map((folder) => (
                <div className="tool-row" key={folder.name}>
                  <span>{folder.name}</span>
                  <em>{folder.delimiter || 'flat'}</em>
                  <small>{folder.attributes.join(', ')}</small>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="tool-panel settings-sync-panel">
        <header className="tool-header">
          <span>
            <strong>同步演练</strong>
            <small>检查调度批次、文件夹状态和增量同步结果</small>
          </span>
          <div className="tool-actions">
            <button className="secondary" type="button" onClick={onRunSyncDryRun}>演练</button>
            <button
              className="secondary"
              disabled={pendingHistoryCount === 0}
              title={pendingHistoryCount === 0 ? '当前账号历史邮件已回填完成' : `为 ${pendingHistoryCount} 个目录各回填一页`}
              type="button"
              onClick={onSyncHistory}
            >
              <History size={14} />
              回填一页
            </button>
            <button type="button" onClick={() => onEnqueueBackgroundTask('sync', 'manual')}>
              <RefreshCw size={14} />
              同步邮件头
            </button>
          </div>
        </header>
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
                    <select
                      aria-label={`映射远端目录 ${mailbox.remote_name}`}
                      onChange={(event) => {
                        const nextFolderId = Number(event.target.value);
                        onMapImapMailbox(mailbox, nextFolderId > 0 ? nextFolderId : null);
                      }}
                      value={mailbox.local_folder_id ?? ''}
                    >
                      <option value="">暂不同步</option>
                      {customFolders.map((folder) => (
                        <option key={folder.id} value={folder.id}>{folder.name}</option>
                      ))}
                    </select>
                    {!mailbox.local_folder_id && (
                      <button
                        className="secondary mailbox-create-map"
                        onClick={() => onCreateAndMapImapMailbox(mailbox)}
                        type="button"
                      >
                        <FolderPlus size={13} />
                        新建同名
                      </button>
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
          <p className="settings-empty-state">还没有同步运行记录。</p>
        ) : (
          <div className="settings-compact-list">
            {syncRuns.map((run) => (
              <div className={run.imported_messages > 0 ? 'tool-row ok' : 'tool-row'} key={run.id}>
                <span>{run.status}</span>
                <em>扫描 {run.scanned_folders} 个文件夹 · 新增 {run.imported_messages} 封</em>
                <small>{formatDate(run.started_at)}</small>
                <p>{run.message}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="tool-panel settings-outbox-panel">
        <header className="tool-header">
          <span>
            <strong>发件箱队列</strong>
            <small>查看排队、定时发送、重试和撤回状态</small>
          </span>
          <div className="tool-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => onEnqueueBackgroundTask('outbox-dry-run', 'manual')}
            >
              发送演练
            </button>
            <button
              type="button"
              onClick={() => onEnqueueBackgroundTask('outbox-smtp', 'manual')}
            >
              <Send size={14} />
              真实发送
            </button>
          </div>
        </header>
        {outbox.length === 0 ? (
          <p className="settings-empty-state">发件箱当前为空。</p>
        ) : (
          <div className="settings-compact-list">
            {outbox.map((item) => (
              <div className="tool-row" key={item.id}>
                <span>{outboxStatusLabel(item.status)}</span>
                <em>{item.recipients}</em>
                <small>{item.attempts} 次</small>
                <p>
                  {item.subject || '(无主题)'}
                  {outboxTimingLabel(item) ? ` · ${outboxTimingLabel(item)}` : ''}
                  {item.last_error ? ` · ${item.last_error}` : ''}
                </p>
                {canCancelOutboxItem(item.status) && (
                  <button className="inline-action" type="button" onClick={() => onCancelOutboxItem(item)}>
                    撤回
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </details>
  );
}
