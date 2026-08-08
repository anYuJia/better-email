import type { AiServiceConfig } from './types/ai';
import { readAppStorage } from './storageConfig';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

export const aiServiceStorageKey = 'better-email.aiService';

export const defaultAiServiceConfig: AiServiceConfig = {
  enabled: false,
  serviceType: 'http',
  endpoint: '',
  apiKey: '',
  defaultModel: 'gpt-4o-mini',
  timeoutSeconds: 30,
  privacyAcknowledged: false,
  mcpEnabled: false,
  mcpEndpoint: 'http://127.0.0.1:8080/mcp',
  mcpApiKey: '',
};

export type AiSettingsInput = {
  enabled: boolean;
  service_type: string;
  endpoint: string;
  api_key: string;
  model: string;
  timeout_seconds: number;
  privacy_acknowledged: boolean;
  mcp_enabled: boolean;
  mcp_endpoint: string;
  mcp_api_key: string;
};

export type AiSettingsReport = {
  enabled: boolean;
  service_type: string;
  endpoint: string;
  api_key: string;
  model: string;
  timeout_seconds: number;
  privacy_acknowledged: boolean;
  mcp_enabled: boolean;
  mcp_endpoint: string;
  mcp_api_key: string;
};

/** 从后端读取 AI 设置（API Key 存放于系统凭据库，不落 localStorage）。 */
export async function loadAiSettingsFromBackend(): Promise<AiSettingsReport | null> {
  try {
    const report = await invoke<AiSettingsReport>(IPC.LoadAiSettings);
    return report ?? null;
  } catch {
    return null;
  }
}

/** 保存 AI 设置到后端（API Key 优先系统凭据库，失败回退本地数据库）。 */
export async function saveAiSettingsToBackend(config: AiServiceConfig): Promise<string> {
  const input: AiSettingsInput = {
    enabled: config.enabled,
    service_type: config.serviceType,
    endpoint: config.endpoint.trim(),
    api_key: config.apiKey,
    model: config.defaultModel.trim() || 'gpt-4o-mini',
    timeout_seconds: config.timeoutSeconds,
    privacy_acknowledged: config.privacyAcknowledged,
    mcp_enabled: config.mcpEnabled === true,
    mcp_endpoint: (config.mcpEndpoint ?? '').trim(),
    mcp_api_key: config.mcpApiKey ?? '',
  };
  return invoke<string>(IPC.SaveAiSettings, { input });
}

function stripSecrets(config: AiServiceConfig): Partial<AiServiceConfig> {
  const { apiKey, mcpApiKey, ...rest } = config;
  void apiKey;
  void mcpApiKey;
  return rest;
}

export function loadAiServiceConfig(): AiServiceConfig {
  try {
    const stored = readAppStorage(aiServiceStorageKey);
    if (!stored) return { ...defaultAiServiceConfig };
    const parsed = JSON.parse(stored) as Partial<AiServiceConfig>;
    return {
      enabled: parsed.enabled ?? defaultAiServiceConfig.enabled,
      serviceType: parsed.serviceType === 'mcp' || parsed.serviceType === 'mock'
        ? parsed.serviceType
        : 'http',
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      apiKey: '',
      defaultModel: typeof parsed.defaultModel === 'string' && parsed.defaultModel.trim()
        ? parsed.defaultModel.trim()
        : defaultAiServiceConfig.defaultModel,
      timeoutSeconds:
        typeof parsed.timeoutSeconds === 'number' && parsed.timeoutSeconds > 0
          ? Math.min(parsed.timeoutSeconds, 300)
          : defaultAiServiceConfig.timeoutSeconds,
      privacyAcknowledged: parsed.privacyAcknowledged === true,
      mcpEnabled: parsed.mcpEnabled === true,
      mcpEndpoint: typeof parsed.mcpEndpoint === 'string' && parsed.mcpEndpoint.trim()
        ? parsed.mcpEndpoint.trim()
        : defaultAiServiceConfig.mcpEndpoint,
      mcpApiKey: '',
    };
  } catch {
    return { ...defaultAiServiceConfig };
  }
}

/** localStorage 只保留非密钥字段；API Key 由后端系统凭据库管理。 */
export function saveAiServiceConfig(config: AiServiceConfig): void {
  window.localStorage.setItem(aiServiceStorageKey, JSON.stringify(stripSecrets(config)));
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}
