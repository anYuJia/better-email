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
  mcpEndpoint: '',
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
  clear_api_key: boolean;
  clear_mcp_api_key: boolean;
};

/** 后端返回的 AI 设置报告：绝不含完整密钥，只有「是否已配置」标志。 */
export type AiSettingsReport = {
  enabled: boolean;
  service_type: string;
  endpoint: string;
  has_api_key: boolean;
  model: string;
  timeout_seconds: number;
  privacy_acknowledged: boolean;
  mcp_enabled: boolean;
  mcp_endpoint: string;
  has_mcp_api_key: boolean;
};

/** 从后端读取 AI 设置（密钥只保存在应用本地数据库，不落 localStorage）。 */
export async function loadAiSettingsFromBackend(): Promise<AiSettingsReport | null> {
  try {
    const report = await invoke<AiSettingsReport>(IPC.LoadAiSettings);
    return report ?? null;
  } catch {
    return null;
  }
}

/** 保存 AI 设置到后端（密钥只写入应用本地数据库）。 */
export async function saveAiSettingsToBackend(config: AiServiceConfig): Promise<string> {
  const input: AiSettingsInput = {
    enabled: config.enabled,
    service_type: config.serviceType,
    endpoint: config.endpoint.trim(),
    // 空值表示「保持现有密钥」；只有用户显式点击清除才删除。
    api_key: config.apiKey,
    model: config.defaultModel.trim() || 'gpt-4o-mini',
    timeout_seconds: config.timeoutSeconds,
    privacy_acknowledged: config.privacyAcknowledged,
    mcp_enabled: config.mcpEnabled === true,
    mcp_endpoint: (config.mcpEndpoint ?? '').trim(),
    mcp_api_key: config.mcpApiKey ?? '',
    clear_api_key: config.clearApiKey === true,
    clear_mcp_api_key: config.clearMcpApiKey === true,
  };
  return invoke<string>(IPC.SaveAiSettings, { input });
}

function stripSecrets(config: AiServiceConfig): Partial<AiServiceConfig> {
  const { apiKey, mcpApiKey, clearApiKey, clearMcpApiKey, ...rest } = config;
  void apiKey;
  void mcpApiKey;
  void clearApiKey;
  void clearMcpApiKey;
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

/** localStorage 只保留非密钥字段；API Key 由后端应用本地数据库管理。 */
export function saveAiServiceConfig(config: AiServiceConfig): void {
  window.localStorage.setItem(aiServiceStorageKey, JSON.stringify(stripSecrets(config)));
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}
