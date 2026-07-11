import type {
  ConnectionReport,
  CredentialVerificationReport,
  ImapProbeReport,
  SyncRun,
} from './types';

export type ProviderValidationStageId = 'connection' | 'credentials' | 'folders' | 'headers';

export type ProviderValidationStageState =
  | 'pending'
  | 'running'
  | 'success'
  | 'warning'
  | 'error'
  | 'skipped';

export type ProviderValidationStage = {
  id: ProviderValidationStageId;
  label: string;
  state: ProviderValidationStageState;
  detail: string;
};

export type ProviderValidationReport = {
  account_email: string;
  started_at: string;
  finished_at: string;
  status: 'running' | 'success' | 'warning' | 'error';
  summary: string;
  stages: ProviderValidationStage[];
};

type ProviderValidationDependencies = {
  testConnection: () => Promise<ConnectionReport>;
  verifyCredentials: () => Promise<CredentialVerificationReport>;
  discoverFolders: () => Promise<ImapProbeReport>;
  syncHeaders: () => Promise<SyncRun>;
  incomingProtocol?: 'imap' | 'pop3';
  onUpdate?: (report: ProviderValidationReport) => void;
  now?: () => string;
};

const stageDefinitions: Array<Pick<ProviderValidationStage, 'id' | 'label'>> = [
  { id: 'connection', label: '服务器' },
  { id: 'credentials', label: '登录' },
  { id: 'folders', label: '文件夹' },
  { id: 'headers', label: '邮件头' },
];

function cloneReport(report: ProviderValidationReport): ProviderValidationReport {
  return {
    ...report,
    stages: report.stages.map((stage) => ({ ...stage })),
  };
}

function publish(
  report: ProviderValidationReport,
  onUpdate?: (report: ProviderValidationReport) => void,
) {
  onUpdate?.(cloneReport(report));
  return report;
}

function updateStage(
  report: ProviderValidationReport,
  id: ProviderValidationStageId,
  patch: Partial<ProviderValidationStage>,
  onUpdate?: (report: ProviderValidationReport) => void,
) {
  return publish({
    ...report,
    stages: report.stages.map((stage) => (
      stage.id === id ? { ...stage, ...patch } : stage
    )),
  }, onUpdate);
}

function skipRemaining(
  report: ProviderValidationReport,
  after: ProviderValidationStageId,
  reason: string,
  onUpdate?: (report: ProviderValidationReport) => void,
) {
  const activeIndex = report.stages.findIndex((stage) => stage.id === after);
  return publish({
    ...report,
    stages: report.stages.map((stage, index) => (
      index > activeIndex && stage.state === 'pending'
        ? { ...stage, state: 'skipped', detail: reason }
        : stage
    )),
  }, onUpdate);
}

function finish(
  report: ProviderValidationReport,
  status: ProviderValidationReport['status'],
  summary: string,
  now: () => string,
  onUpdate?: (report: ProviderValidationReport) => void,
) {
  return publish({
    ...report,
    status,
    summary,
    finished_at: now(),
  }, onUpdate);
}

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createProviderValidationReport(
  accountEmail: string,
  now: () => string = () => new Date().toISOString(),
): ProviderValidationReport {
  return {
    account_email: accountEmail,
    started_at: now(),
    finished_at: '',
    status: 'running',
    summary: '准备执行只读验收，不发送邮件或修改远端邮件状态。',
    stages: stageDefinitions.map((stage) => ({
      ...stage,
      state: 'pending',
      detail: '等待执行',
    })),
  };
}

export async function runProviderValidation(
  accountEmail: string,
  dependencies: ProviderValidationDependencies,
): Promise<ProviderValidationReport> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const onUpdate = dependencies.onUpdate;
  const incomingProtocol = dependencies.incomingProtocol ?? 'imap';
  const incomingLabel = incomingProtocol === 'pop3' ? 'POP3' : 'IMAP';
  const folderLabel = incomingProtocol === 'pop3' ? '收件箱' : '文件夹';
  let report = publish(createProviderValidationReport(accountEmail, now), onUpdate);
  let hasWarning = false;

  report = updateStage(report, 'connection', {
    state: 'running',
    detail: `正在检查 ${incomingLabel} 与 SMTP 端点`,
  }, onUpdate);
  try {
    const connection = await dependencies.testConnection();
    const reachableCount = connection.endpoints.filter((endpoint) => endpoint.reachable).length;
    if (!connection.ready_for_credentials) {
      const incomingReachable = connection.endpoints.some(
        (endpoint) => {
          const name = endpoint.name.toLowerCase();
          return (name.includes('imap') || name.includes('pop3')) && endpoint.reachable;
        },
      );
      if (incomingReachable) {
        hasWarning = true;
        report = updateStage(report, 'connection', {
          state: 'warning',
          detail: `${reachableCount}/${connection.endpoints.length} 个端点可连接；${incomingLabel} 可达，继续只读收信验收`,
        }, onUpdate);
      } else {
        report = updateStage(report, 'connection', {
          state: 'error',
          detail: `${reachableCount}/${connection.endpoints.length} 个端点可连接，${incomingLabel} 不可达`,
        }, onUpdate);
        report = skipRemaining(report, 'connection', `${incomingLabel} 服务器连接未通过`, onUpdate);
        return finish(
          report,
          'error',
          `只读验收已停止：请先修复 ${incomingLabel} 地址、TLS 或网络连接。`,
          now,
          onUpdate,
        );
      }
    } else {
      report = updateStage(report, 'connection', {
      state: 'success',
      detail: `${connection.endpoints.length} 个端点均可连接`,
      }, onUpdate);
    }
  } catch (error) {
    report = updateStage(report, 'connection', {
      state: 'error',
      detail: errorDetail(error),
    }, onUpdate);
    report = skipRemaining(report, 'connection', '服务器测试执行失败', onUpdate);
    return finish(report, 'error', '只读验收失败：服务器测试未完成。', now, onUpdate);
  }

  report = updateStage(report, 'credentials', {
    state: 'running',
    detail: `正在验证 ${incomingLabel} 与 SMTP 登录`,
  }, onUpdate);
  try {
    const verification = await dependencies.verifyCredentials();
    if (!verification.authenticated) {
      const incomingAuthenticated = verification.checks.some(
        (check) => {
          const name = check.name.toLowerCase();
          return (name.includes('imap') || name.includes('pop3')) && check.authenticated;
        },
      );
      if (verification.status === 'partial' && incomingAuthenticated) {
        hasWarning = true;
        report = updateStage(report, 'credentials', {
          state: 'warning',
          detail: `${incomingLabel} 已认证，SMTP 未通过；继续只读收信验收`,
        }, onUpdate);
      } else {
        const state = verification.status === 'partial' ? 'warning' : 'error';
        report = updateStage(report, 'credentials', {
          state,
          detail: verification.message,
        }, onUpdate);
        report = skipRemaining(report, 'credentials', `${incomingLabel} 登录未通过`, onUpdate);
        return finish(
          report,
          state,
          state === 'warning'
            ? `只读验收部分完成：SMTP 可用，但 ${incomingLabel} 仍需修复。`
            : `只读验收已停止：当前授权信息未通过 ${incomingLabel} 认证。`,
          now,
          onUpdate,
        );
      }
    } else {
      report = updateStage(report, 'credentials', {
        state: 'success',
        detail: `${incomingLabel} 与 SMTP 均已认证`,
      }, onUpdate);
    }
  } catch (error) {
    report = updateStage(report, 'credentials', {
      state: 'error',
      detail: errorDetail(error),
    }, onUpdate);
    report = skipRemaining(report, 'credentials', '登录验证执行失败', onUpdate);
    return finish(report, 'error', '只读验收失败：登录验证未完成。', now, onUpdate);
  }

  report = updateStage(report, 'folders', {
    state: 'running',
    detail: incomingProtocol === 'pop3' ? '正在检查 POP3 收件箱' : '正在读取远端文件夹结构',
  }, onUpdate);
  let folderCount = 0;
  try {
    const folders = await dependencies.discoverFolders();
    folderCount = folders.folder_count;
    if (folders.status !== 'ok' || folders.folder_count === 0) {
      const state = folders.status === 'ok' ? 'warning' : 'error';
      report = updateStage(report, 'folders', {
        state,
        detail: folders.message,
      }, onUpdate);
      report = skipRemaining(report, 'folders', '未发现可同步文件夹', onUpdate);
      return finish(
        report,
        state,
        `只读验收已停止：没有可用于首轮同步的远端${folderLabel}。`,
        now,
        onUpdate,
      );
    }
    report = updateStage(report, 'folders', {
      state: 'success',
      detail: incomingProtocol === 'pop3' ? 'POP3 收件箱可同步' : `发现 ${folders.folder_count} 个远端文件夹`,
    }, onUpdate);
  } catch (error) {
    report = updateStage(report, 'folders', {
      state: 'error',
      detail: errorDetail(error),
    }, onUpdate);
    report = skipRemaining(report, 'folders', '文件夹发现执行失败', onUpdate);
    return finish(report, 'error', '只读验收失败：远端文件夹发现未完成。', now, onUpdate);
  }

  report = updateStage(report, 'headers', {
    state: 'running',
    detail: '正在执行首轮邮件头同步',
  }, onUpdate);
  try {
    const sync = await dependencies.syncHeaders();
    const failed = sync.status.includes('failed') || sync.scanned_folders === 0;
    const partial = sync.status.includes('partial');
    const state: ProviderValidationStageState = failed ? 'error' : partial ? 'warning' : 'success';
    hasWarning = hasWarning || partial;
    report = updateStage(report, 'headers', {
      state,
      detail: `扫描 ${sync.scanned_folders} 个目录，导入 ${sync.imported_messages} 封邮件头`,
    }, onUpdate);
    const finalStatus: ProviderValidationReport['status'] = failed
      ? 'error'
      : hasWarning
        ? 'warning'
        : 'success';
    const summary = failed
      ? '只读验收失败：未能同步任何远端邮件头。'
      : hasWarning
        ? `只读验收部分通过：收信链路已扫描 ${sync.scanned_folders} 个目录，SMTP 或部分网络仍需修复；未发送邮件或修改远端状态。`
        : `只读验收通过：发现 ${folderCount} 个文件夹，扫描 ${sync.scanned_folders} 个目录，未发送邮件或修改远端邮件状态。`;
    return finish(
      report,
      finalStatus,
      summary,
      now,
      onUpdate,
    );
  } catch (error) {
    report = updateStage(report, 'headers', {
      state: 'error',
      detail: errorDetail(error),
    }, onUpdate);
    return finish(report, 'error', '只读验收失败：首轮邮件头同步未完成。', now, onUpdate);
  }
}
