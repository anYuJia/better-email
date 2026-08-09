import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiServiceConfig, AiTestConnectionResult } from '../app/types/ai';
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
};

export default function useAiService({ setStatus }: UseAiServiceOptions) {
  const [config, setConfig] = useState<AiServiceConfig>(() => loadAiServiceConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestConnectionResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [secretsLoaded, setSecretsLoaded] = useState(false);

  useEffect(() => {
    saveAiServiceConfig(config);
  }, [config]);

  // 从后端本地数据库恢复设置，不回写 localStorage。
  // 后端刻意不把 AI 密钥放入系统凭据库，打开设置页不会触发任何 Keychain 访问。
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
        apiKey: report.api_key,
        defaultModel: report.model || current.defaultModel,
        timeoutSeconds: report.timeout_seconds || current.timeoutSeconds,
        privacyAcknowledged: report.privacy_acknowledged,
        mcpEnabled: report.mcp_enabled,
        mcpEndpoint: report.mcp_endpoint || current.mcpEndpoint,
        mcpApiKey: report.mcp_api_key,
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
  }, []);

  const runTestConnection = useCallback(async () => {
    setTesting(true);
    try {
      const result = await testAiConnection(config);
      setTestResult(result);
      setStatus(result.ok ? result.message : `AI 服务测试失败：${result.message}`);
    } finally {
      setTesting(false);
    }
  }, [config, setStatus]);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    try {
      const message = await saveAiSettingsToBackend(config);
      setStatus(message);
      return message;
    } finally {
      setSaving(false);
    }
  }, [config, setStatus]);

  return {
    config,
    setConfig,
    patchConfig,
    maskedApiKey,
    testResult,
    testing,
    saving,
    saveConfig,
    runTestConnection,
    defaultConfig: defaultAiServiceConfig,
    secretsLoaded,
  };
}
