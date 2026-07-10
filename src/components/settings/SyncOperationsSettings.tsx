import {
  BadgeCheck,
  FileCheck2,
  FolderPlus,
  History,
  KeyRound,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import {
  canCancelOutboxItem,
  outboxStatusLabel,
  outboxTimingLabel,
} from '../../app/appConfig';
import type { ProviderValidationReport } from '../../app/providerValidation';
import type {
  Account,
  BackgroundTaskKind,
  ConnectionReport,
  CredentialStatus,
  CredentialVerificationReport,
  Folder,
  ImapMailboxState,
  ImapProbeReport,
  OutboxItem,
  SyncRun,
  SyncSchedulePlan,
} from '../../app/types';
import { formatDate } from '../../mailUtils';
import ConnectionDiagnosticsPanel from './ConnectionDiagnosticsPanel';
import './data-settings.css';

type SyncOperationsSettingsProps = {
  accountForm: Account;
  credentialSecret: string;
  credentialStatus: CredentialStatus | null;
  connectionReport: ConnectionReport | null;
  credentialVerification: CredentialVerificationReport | null;
  providerValidationReport: ProviderValidationReport | null;
  providerValidationRunning: boolean;
  imapProbe: ImapProbeReport | null;
  syncSchedulePlan: SyncSchedulePlan | null;
  imapMailboxes: ImapMailboxState[];
  folders: Folder[];
  syncRuns: SyncRun[];
  outbox: OutboxItem[];
  onCredentialSecretChange: (value: string) => void;
  onDiscoverImapFolders: () => void;
  onCheckCredential: () => void;
  onVerifyCredential: () => void;
  onRunProviderValidation: () => void;
  onPrepareWriteValidation: () => void;
  onDeleteCredential: () => void;
  onStoreCredential: () => void;
  onRunSyncDryRun: () => void;
  onSyncHistory: () => void;
  onMapImapMailbox: (mailbox: ImapMailboxState, folderId: number | null) => void;
  onCreateAndMapImapMailbox: (mailbox: ImapMailboxState) => void;
  onEnqueueBackgroundTask: (kind: BackgroundTaskKind, source: 'manual' | 'timer') => void;
  onCancelOutboxItem: (item: OutboxItem) => void;
};

export default function SyncOperationsSettings({
  accountForm,
  credentialSecret,
  credentialStatus,
  connectionReport,
  credentialVerification,
  providerValidationReport,
  providerValidationRunning,
  imapProbe,
  syncSchedulePlan,
  imapMailboxes,
  folders,
  syncRuns,
  outbox,
  onCredentialSecretChange,
  onDiscoverImapFolders,
  onCheckCredential,
  onVerifyCredential,
  onRunProviderValidation,
  onPrepareWriteValidation,
  onDeleteCredential,
  onStoreCredential,
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
    <details className="settings-disclosure" data-settings-section="sync">
      <summary>
        <span>
          <strong>同步与发信高级工具</strong>
          <em>IMAP 发现、同步演练、凭据和发件箱队列</em>
        </span>
        <b>{syncRuns.length ? `${syncRuns.length} 次` : '待运行'}</b>
      </summary>

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

      <section className="tool-panel settings-credential-panel" data-settings-section="auth">
        <header className="tool-header">
          <span>
            <strong>系统凭据库</strong>
            <small>{accountForm.email}</small>
          </span>
          <em>{credentialStatus?.exists ? '已保存' : '未保存'}</em>
        </header>
        <label>
          {accountForm.auth_type === 'oauth2' ? 'OAuth2 Token' : '应用专用密码 / 授权码'}
          <input
            type="password"
            value={credentialSecret}
            autoComplete="new-password"
            onChange={(event) => onCredentialSecretChange(event.target.value)}
            placeholder="只写入系统安全存储，不进入本地数据库"
          />
        </label>
        <div className="credential-actions">
          <button className="secondary" type="button" onClick={onCheckCredential}>检查存储</button>
          <button className="secondary danger" type="button" onClick={onDeleteCredential}>
            <Trash2 size={14} />
            删除
          </button>
          <button className="secondary" type="button" onClick={onStoreCredential}>
            <KeyRound size={14} />
            保存凭据
          </button>
          <button type="button" title="验证 IMAP 与 SMTP 登录，不会发送邮件" onClick={onVerifyCredential}>
            <BadgeCheck size={14} />
            验证登录
          </button>
        </div>
        <ConnectionDiagnosticsPanel
          account={accountForm}
          credentialStatus={credentialStatus}
          connectionReport={connectionReport}
          credentialVerification={credentialVerification}
          providerValidationReport={providerValidationReport}
          providerValidationRunning={providerValidationRunning}
          onRunProviderValidation={onRunProviderValidation}
        />
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

      <details className="tool-panel settings-write-validation">
        <summary>
          <span>
            <strong>发送与回写验收</strong>
            <small>生成发给自己的验证草稿，真实发送前仍需在撰写器中确认</small>
          </span>
          <b>需手动确认</b>
        </summary>
        <div>
          <p>
            草稿不会自动发送，也不会自动添加附件。请检查收件人，按需添加不含敏感信息的小文件，
            再手动发送并验证已发送留档、自发自收、附件读取和远端状态回写。
          </p>
          <ol>
            <li>默认收件人为当前账号，避免向第三方发送测试邮件。</li>
            <li>主题包含唯一验证编号，便于在已发送和收件箱中定位。</li>
            <li>不要在草稿或附件中放入密码、授权码或 Token。</li>
          </ol>
          <button type="button" onClick={onPrepareWriteValidation}>
            <FileCheck2 size={14} />
            生成验证草稿
          </button>
        </div>
      </details>

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
