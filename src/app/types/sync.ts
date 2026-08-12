import type { Account } from './account';

export type BackgroundTaskKind = 'sync' | 'outbox-dry-run' | 'outbox-smtp';
/** done 即成功（succeeded）语义，与历史状态保持一致。 */
export type BackgroundTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';


export type LocalBackupSummary = {
  path: string;
  exported_at: string;
  app_version: string;
  schema_version: number;
  accounts: number;
  messages: number;
  labels: number;
  rules: number;
  outbox_items: number;
  size_bytes: number;
  credentials_included: boolean;
};


export type StorageUsage = {
  database_bytes: number;
  reclaimable_cache_bytes: number;
  reclaimable_file_count: number;
  cached_attachment_count: number;
  local_attachment_bytes: number;
  local_attachment_file_count: number;
  partial_download_bytes: number;
  partial_download_count: number;
  total_managed_bytes: number;
};


export type CacheClearResult = {
  removed_file_count: number;
  reset_attachment_count: number;
  released_bytes: number;
  storage: StorageUsage;
};

export type AppSettingsReport = {
  configured_dir: string;
  effective_dir: string;
  using_default: boolean;
};

export type DownloadDirSetResult = {
  settings: AppSettingsReport;
  cancelled: boolean;
};


export type SyncRun = {
  id: number;
  started_at: string;
  finished_at: string;
  status: string;
  scanned_folders: number;
  imported_messages: number;
  /** 真正新增的邮件数（不含历史补同步）。 */
  new_messages: number;
  /** 本次同步真正新增邮件的本地 message id（通知候选来源，不依赖当前 UI 列表）。 */
  new_message_ids: number[];
  message: string;
};


export type SyncSchedulePlan = {
  max_accounts_per_batch: number;
  total_accounts: number;
  batch_accounts: Account[];
  delayed_accounts: Account[];
  strategy: string;
};


export type BackgroundTask = {
  id: number;
  kind: BackgroundTaskKind;
  title: string;
  source: 'manual' | 'timer' | 'initial';
  status: BackgroundTaskStatus;
  message: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  /** 绑定明确账号的任务（首次登录后台同步）；null 表示全局任务。 */
  account_id: number | null;
  /** 运行中任务被请求取消：执行方在安全检查点消费后落为 cancelled。 */
  cancel_requested: boolean;
  /** 文件夹/批次级进度（0-100），由 Rust 同步流程在安全检查点写入。 */
  progress: number;
};

