import type { Account } from './types';

/** Fields that participate in connection settings dirty detection. */
export type AccountConnectionSettingsSnapshot = {
  display_name: string;
  provider: string;
  imap_host: string;
  smtp_host: string;
  incoming_protocol: string;
  auth_type: string;
  sync_mode: string;
  remote_images_allowed: boolean;
  signature: string;
};

export function accountConnectionSettingsSnapshot(
  account: Pick<Account, keyof AccountConnectionSettingsSnapshot>,
): AccountConnectionSettingsSnapshot {
  return {
    display_name: account.display_name ?? '',
    provider: account.provider ?? '',
    imap_host: account.imap_host ?? '',
    smtp_host: account.smtp_host ?? '',
    incoming_protocol: account.incoming_protocol ?? 'imap',
    auth_type: account.auth_type ?? 'password',
    sync_mode: account.sync_mode ?? 'manual',
    remote_images_allowed: Boolean(account.remote_images_allowed),
    signature: account.signature ?? '',
  };
}

export function accountConnectionSettingsEqual(
  left: Pick<Account, keyof AccountConnectionSettingsSnapshot> | null | undefined,
  right: Pick<Account, keyof AccountConnectionSettingsSnapshot> | null | undefined,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  const a = accountConnectionSettingsSnapshot(left);
  const b = accountConnectionSettingsSnapshot(right);
  return (
    a.display_name === b.display_name
    && a.provider === b.provider
    && a.imap_host === b.imap_host
    && a.smtp_host === b.smtp_host
    && a.incoming_protocol === b.incoming_protocol
    && a.auth_type === b.auth_type
    && a.sync_mode === b.sync_mode
    && a.remote_images_allowed === b.remote_images_allowed
    && a.signature === b.signature
  );
}

export function isAccountConnectionDirty(
  persisted: Account | null | undefined,
  draft: Account | null | undefined,
): boolean {
  if (!persisted || !draft) return false;
  if (persisted.id !== draft.id) return false;
  return !accountConnectionSettingsEqual(persisted, draft);
}

export type SaveAndVerifyStageId =
  | 'save'
  | 'server'
  | 'credential'
  | 'incoming'
  | 'smtp';

export type SaveAndVerifyStageState =
  | 'pending'
  | 'running'
  | 'success'
  | 'partial'
  | 'error'
  | 'needs_auth';

export type SaveAndVerifyStage = {
  id: SaveAndVerifyStageId;
  label: string;
  state: SaveAndVerifyStageState;
  detail: string;
};

export type SaveAndVerifyReport = {
  overall: SaveAndVerifyStageState;
  summary: string;
  stages: SaveAndVerifyStage[];
  technicalDetails: string[];
};

export function emptySaveAndVerifyReport(): SaveAndVerifyReport {
  return {
    overall: 'pending',
    summary: '尚未开始验证',
    stages: [
      { id: 'save', label: '保存配置', state: 'pending', detail: '等待保存' },
      { id: 'server', label: '服务器连接', state: 'pending', detail: '等待检查' },
      { id: 'credential', label: '系统凭据', state: 'pending', detail: '等待检查' },
      { id: 'incoming', label: '收信认证', state: 'pending', detail: '等待检查' },
      { id: 'smtp', label: '发信认证', state: 'pending', detail: '等待检查' },
    ],
    technicalDetails: [],
  };
}

export function deriveSaveAndVerifyOverall(
  stages: SaveAndVerifyStage[],
): SaveAndVerifyStageState {
  const saveOrServerFailed = stages.some((stage) => (
    (stage.id === 'save' || stage.id === 'server') && stage.state === 'error'
  ));
  if (saveOrServerFailed) return 'error';
  const authStates = stages
    .filter((stage) => stage.id === 'incoming' || stage.id === 'smtp')
    .map((stage) => stage.state);
  if (authStates.includes('success') && authStates.includes('error')) return 'partial';
  if (stages.some((stage) => stage.state === 'error')) return 'error';
  if (stages.some((stage) => stage.state === 'partial')) return 'partial';
  if (stages.some((stage) => stage.state === 'needs_auth')) return 'needs_auth';
  if (stages.some((stage) => stage.state === 'running')) return 'running';
  if (stages.every((stage) => stage.state === 'success')) return 'success';
  return 'pending';
}

export function saveAndVerifySummary(
  stages: SaveAndVerifyStage[],
  authType: string,
  authTypeChanged: boolean,
): string {
  const stateFor = (id: SaveAndVerifyStageId) => (
    stages.find((stage) => stage.id === id)?.state ?? 'pending'
  );
  const boolFor = (id: SaveAndVerifyStageId): boolean | null => {
    const state = stateFor(id);
    if (state === 'success') return true;
    if (state === 'error' || state === 'partial' || state === 'needs_auth') return false;
    return null;
  };

  if (stateFor('server') === 'partial') {
    return '仅部分服务器可连接，请检查服务器地址与技术详情';
  }

  return userFacingVerifyMessage({
    serverOk: boolFor('server'),
    credentialExists: boolFor('credential'),
    incomingOk: boolFor('incoming'),
    smtpOk: boolFor('smtp'),
    authType,
    authTypeChanged,
  });
}

export function updateSaveAndVerifyReportStage(
  report: SaveAndVerifyReport,
  stageId: SaveAndVerifyStageId,
  state: SaveAndVerifyStageState,
  detail: string,
  options: {
    authType: string;
    authTypeChanged: boolean;
    technicalDetail?: string;
  },
): SaveAndVerifyReport {
  const stages = report.stages.map((stage) => (
    stage.id === stageId ? { ...stage, state, detail } : stage
  ));
  return {
    ...report,
    stages,
    overall: deriveSaveAndVerifyOverall(stages),
    summary: saveAndVerifySummary(stages, options.authType, options.authTypeChanged),
    technicalDetails: options.technicalDetail
      ? [...report.technicalDetails, options.technicalDetail]
      : report.technicalDetails,
  };
}

export function authTypeChangeMessage(
  previousAuthType: string | null | undefined,
  nextAuthType: string | null | undefined,
): string | null {
  const prev = (previousAuthType ?? '').trim().toLowerCase();
  const next = (nextAuthType ?? '').trim().toLowerCase();
  if (!prev || !next || prev === next) return null;
  if (prev === 'password' && next === 'oauth2') {
    return '认证方式已修改为 OAuth2，需要重新完成授权。';
  }
  if (prev === 'oauth2' && next === 'password') {
    return '认证方式已修改为授权码，需要重新保存应用专用密码 / 客户端授权码。';
  }
  return '认证方式已修改，需要重新认证。';
}

export function userFacingVerifyMessage(params: {
  serverOk: boolean | null;
  credentialExists: boolean | null;
  incomingOk: boolean | null;
  smtpOk: boolean | null;
  authType: string;
  authTypeChanged: boolean;
}): string {
  if (params.authTypeChanged) {
    return params.authType === 'oauth2'
      ? '配置已保存，需要重新完成 OAuth2 授权'
      : '配置已保存，需要重新保存并验证授权码';
  }
  if (params.credentialExists === false) {
    return params.authType === 'oauth2'
      ? '尚未保存 OAuth2 Token，请先完成授权'
      : '尚未保存授权码，请输入服务商生成的客户端授权码';
  }
  if (params.incomingOk === true && params.smtpOk === false) {
    return '收信认证成功，发信认证失败';
  }
  if (params.incomingOk === false && params.smtpOk === true) {
    return '发信认证成功，收信认证失败';
  }
  if (params.incomingOk === true && params.smtpOk === true) {
    return '收信与发信认证均已通过';
  }
  if (params.serverOk === false) {
    return '服务器连接失败，请检查主机与端口';
  }
  if (params.serverOk === true && params.credentialExists === null) {
    return '服务器可连接，正在检查账号认证';
  }
  return '验证未完成';
}

/** Known ordinary provider option ids shown in the simplified provider picker. */
export const ordinaryProviderOptions = [
  { id: 'gmail', label: 'Gmail', provider: 'gmail' },
  { id: 'outlook', label: 'Outlook', provider: 'outlook' },
  { id: 'qq', label: 'QQ 邮箱', provider: 'qq' },
  { id: 'netease', label: '网易邮箱', provider: 'netease' },
  { id: 'custom', label: '自定义邮箱', provider: 'custom' },
] as const;

export type OrdinaryProviderOptionId = (typeof ordinaryProviderOptions)[number]['id'];

export function resolveOrdinaryProviderOption(provider: string): OrdinaryProviderOptionId {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'gmail' || normalized === 'google') return 'gmail';
  if (normalized === 'outlook' || normalized === 'office365' || normalized === 'microsoft') return 'outlook';
  if (normalized === 'qq') return 'qq';
  if (normalized === 'netease' || normalized === '163') return 'netease';
  return 'custom';
}

export function isCustomProvider(provider: string): boolean {
  return resolveOrdinaryProviderOption(provider) === 'custom';
}
