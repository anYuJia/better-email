import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiServiceConfig, AiServiceType, AiTestConnectionResult } from '../app/types/ai';
import {
  defaultAiServiceConfig,
  loadAiServiceConfig,
  loadAiSettingsFromBackend,
  maskApiKey,
  saveAiServiceConfig,
  saveAiSettingsToBackend,
} from '../app/aiServiceConfig';
import { testAiConnection } from '../app/aiService';

type UseAiServiceOptions = {
  setStatus: (status: string) => void;
  /**
   * Settings pages expose one connector at a time. The persisted config still
   * keeps both connector credentials, while test/save use the page's service
   * type as the active route.
   */
  serviceType?: AiServiceType;
};

export default function useAiService({ setStatus, serviceType }: UseAiServiceOptions) {
  const [config, setConfig] = useState<AiServiceConfig>(() => loadAiServiceConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestConnectionResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [secretsLoaded, setSecretsLoaded] = useState(false);

  const requestConfig = useMemo(() => (
    serviceType && config.serviceType !== serviceType
      ? { ...config, serviceType }
      : config
  ), [config, serviceType]);

  useEffect(() => {
    saveAiServiceConfig(config);
  }, [config]);

  // 从后端本地数据库恢复设置，不回写 localStorage。
  // 后端刻意不把 AI 密钥放入系统凭据库，打开设置页不会触发任何 Keychain 访问。
  // 后端绝不回传完整密钥：只返回 has_api_key 标志，apiKey 输入框保持空值表示
  // 「保持现有密钥」，保存时后端会保留已存密钥。
  useEffect(() => {
    let cancelled = false;
    loadAiSettingsFromBackend().then((report) => {
      if (cancelled || !report) return;
      setConfig((current) => ({
        ...current,
        enabled: report.enabled,
        serviceType: report.service_type === 'mcp' || report.service_type === 'mock'
          ? report.service_type
          : 'http',
        endpoint: report.endpoint,
        apiKey: '',
        hasApiKey: report.has_api_key,
        defaultModel: report.model || current.defaultModel,
        timeoutSeconds: report.timeout_seconds || current.timeoutSeconds,
        privacyAcknowledged: report.privacy_acknowledged,
        mcpEnabled: report.mcp_enabled,
        mcpEndpoint: report.mcp_endpoint || current.mcpEndpoint,
        mcpApiKey: '',
        hasMcpApiKey: report.has_mcp_api_key,
      }));
      setSecretsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const maskedApiKey = useMemo(() => maskApiKey(config.apiKey), [config.apiKey]);

  const patchConfig = useCallback((patch: Partial<AiServiceConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setTestResult(null);
    setSaveError(null);
  }, []);

  const runTestConnection = useCallback(async () => {
    setTesting(true);
    try {
      const result = await testAiConnection(requestConfig);
      setTestResult(result);
      setStatus(result.ok ? result.message : `AI 服务测试失败：${result.message}`);
    } finally {
      setTesting(false);
    }
  }, [requestConfig, setStatus]);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const message = await saveAiSettingsToBackend(requestConfig);
      // 清除标记只发一次；保存成功后复位，避免 localStorage/下次保存误清。
      setConfig((current) => ({
        ...current,
        ...(serviceType ? { serviceType } : {}),
        clearApiKey: false,
        clearMcpApiKey: false,
      }));
      setStatus(message);
      return message;
    } catch (error) {
      // 后端拒绝（例如端点变化时空 key 不得沿用旧 key）必须可见，不能让用户以为已保存。
      setSaveError(String(error));
      throw error;
    } finally {
      setSaving(false);
    }
  }, [requestConfig, serviceType, setStatus]);

  return {
    config,
    setConfig,
    patchConfig,
    maskedApiKey,
    testResult,
    testing,
    saving,
    saveError,
    saveConfig,
    runTestConnection,
    defaultConfig: defaultAiServiceConfig,
    secretsLoaded,
  };
}
