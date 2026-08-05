import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiServiceConfig, AiTestConnectionResult } from '../app/types/ai';
import {
  defaultAiServiceConfig,
  loadAiServiceConfig,
  maskApiKey,
  saveAiServiceConfig,
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

  useEffect(() => {
    saveAiServiceConfig(config);
  }, [config]);

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
      setStatus('AI 服务设置已保存');
    } finally {
      setSaving(false);
    }
  }, [setStatus]);

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
  };
}
