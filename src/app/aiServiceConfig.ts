import type { AiServiceConfig } from './types/ai';
import { readAppStorage } from './storageConfig';

export const aiServiceStorageKey = 'better-email.aiService';

export const defaultAiServiceConfig: AiServiceConfig = {
  enabled: false,
  serviceType: 'http',
  endpoint: '',
  apiKey: '',
  defaultModel: 'gpt-4o-mini',
  timeoutSeconds: 30,
  privacyAcknowledged: false,
};

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
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      defaultModel: typeof parsed.defaultModel === 'string' && parsed.defaultModel.trim()
        ? parsed.defaultModel.trim()
        : defaultAiServiceConfig.defaultModel,
      timeoutSeconds:
        typeof parsed.timeoutSeconds === 'number' && parsed.timeoutSeconds > 0
          ? Math.min(parsed.timeoutSeconds, 300)
          : defaultAiServiceConfig.timeoutSeconds,
      privacyAcknowledged: parsed.privacyAcknowledged === true,
    };
  } catch {
    return { ...defaultAiServiceConfig };
  }
}

export function saveAiServiceConfig(config: AiServiceConfig): void {
  window.localStorage.setItem(aiServiceStorageKey, JSON.stringify(config));
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}
