import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiServiceConfig, AiServiceType, AiTestConnectionResult } from '../app/types/ai';
import {
  defaultAiServiceConfig,
  hasPersistedAiSettings,
  isNativeAiRuntime,
  loadAiServiceConfig,
  loadAiSettingsFromBackend,
  maskApiKey,
  mergePersistedAiSettings,
  saveAiServiceConfig,
  saveAiSettingsToBackend,
} from '../app/aiServiceConfig';
import { testAiConnection } from '../app/aiService';

export type AiServiceNotificationTone = 'success' | 'error' | 'info';

const AI_SETTINGS_MIGRATION_DELAYS_MS = [0, 100, 300, 700];

function waitForAiSettingsMigrationRetry(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

type UseAiServiceOptions = {
  setStatus?: (status: string) => void;
  onNotify?: (message: string, tone?: AiServiceNotificationTone) => void;
  /**
   * Settings pages expose one connector at a time. The persisted config still
   * keeps both connector credentials, while test/save use the page's service
   * type as the active route.
   */
  serviceType?: AiServiceType;
};

async function migrateLocalAiSettingsToBackend(
  initialReport: Awaited<ReturnType<typeof loadAiSettingsFromBackend>>,
): Promise<Awaited<ReturnType<typeof loadAiSettingsFromBackend>>> {
  if (!isNativeAiRuntime()) return initialReport;

  const localConfig = loadAiServiceConfig();
  if (localConfig.enabled === false || (initialReport && hasPersistedAiSettings(initialReport))) {
    return initialReport;
  }

  let report = initialReport;
  for (const delayMs of AI_SETTINGS_MIGRATION_DELAYS_MS) {
    await waitForAiSettingsMigrationRetry(delayMs);
    try {
      // A failed read is not an empty store. Confirm the backend has no row
      // before migrating a possibly stale mirror after startup recovers.
      const latest = await loadAiSettingsFromBackend();
      if (!latest) continue;
      if (hasPersistedAiSettings(latest)) return latest;
      // Older native builds only wrote the non-secret mirror to localStorage.
      // Persist that preference into the shared SQLite store so the Rust
      // request gate and a second native window see the same enabled value.
      await saveAiSettingsToBackend(localConfig);
      report = await loadAiSettingsFromBackend();
      if (report && hasPersistedAiSettings(report)) return report;
    } catch {
      // The backend may still be bootstrapping. Retry without surfacing a
      // transient migration error as a settings save failure.
    }
  }
  return report;
}

export default function useAiService({ setStatus, onNotify, serviceType }: UseAiServiceOptions) {
  const [config, setConfig] = useState<AiServiceConfig>(() => loadAiServiceConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestConnectionResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [secretsLoaded, setSecretsLoaded] = useState(false);
  const revisionRef = useRef(0);
  const testingRef = useRef(false);
  const savingRef = useRef(false);

  const requestConfig = useMemo(() => (
    serviceType && config.serviceType !== serviceType
      ? { ...config, serviceType }
      : config
  ), [config, serviceType]);

  const notify = useCallback((message: string, tone: AiServiceNotificationTone = 'success') => {
    if (onNotify) {
      onNotify(message, tone);
      return;
    }
    setStatus?.(message);
  }, [onNotify, setStatus]);

  // 从后端本地数据库恢复设置，localStorage 只同步已保存的非密钥字段。
  // 后端刻意不把 AI 密钥放入系统凭据库，打开设置页不会触发任何 Keychain 访问。
  // 后端绝不回传完整密钥：只返回 has_api_key 标志，apiKey 输入框保持空值表示
  // 「保持现有密钥」，保存时后端会保留已存密钥。
  useEffect(() => {
    let cancelled = false;
    const initialRevision = revisionRef.current;
    const hydrate = (report: NonNullable<Awaited<ReturnType<typeof loadAiSettingsFromBackend>>>) => {
      setConfig((current) => {
        const persisted = mergePersistedAiSettings(current, report);
        saveAiServiceConfig(persisted);
        return revisionRef.current === initialRevision ? persisted : current;
      });
    };
    loadAiSettingsFromBackend()
      .then(async (report) => {
        if (cancelled) return;
        // A fresh/mock backend can legitimately have no settings row. Do not
        // replace a recoverable local configuration with its empty defaults.
        if (report && hasPersistedAiSettings(report)) {
          hydrate(report);
        } else {
          const migratedReport = await migrateLocalAiSettingsToBackend(report);
          if (!cancelled && migratedReport && hasPersistedAiSettings(migratedReport)) {
            hydrate(migratedReport);
          }
        }
        if (!cancelled) setSecretsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSecretsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceType]);

  // localStorage mirrors persisted settings only; cancelled guide drafts must
  // never become the runtime configuration in another window.

  const maskedApiKey = useMemo(() => maskApiKey(config.apiKey), [config.apiKey]);

  const patchConfig = useCallback((patch: Partial<AiServiceConfig>) => {
    revisionRef.current += 1;
    setConfig((current) => ({
      ...current,
      ...patch,
      ...(patch.apiKey?.trim() ? { clearApiKey: false } : {}),
      ...(patch.mcpApiKey?.trim() ? { clearMcpApiKey: false } : {}),
    }));
    setTestResult(null);
    setSaveError(null);
  }, []);

  const runTestConnection = useCallback(async () => {
    if (testingRef.current) return;
    testingRef.current = true;
    const revision = revisionRef.current;
    setTesting(true);
    try {
      const result = await testAiConnection(requestConfig);
      if (revisionRef.current !== revision) return;
      setTestResult(result);
      const message = result.ok || /^测试连接失败/.test(result.message)
        ? result.message
        : `测试连接失败：${result.message}`;
      notify(
        message,
        result.ok ? 'success' : 'error',
      );
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  }, [notify, requestConfig]);

  const saveConfig = useCallback(async (overrides: Partial<AiServiceConfig> = {}) => {
    if (savingRef.current) throw new Error('设置正在保存，请稍候。');
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const configToSave: AiServiceConfig = {
      ...requestConfig,
      ...overrides,
      ...(serviceType ? { serviceType } : {}),
    };
    if (configToSave.serviceType === 'mcp' && configToSave.mcpEnabled !== true) {
      configToSave.serviceType = 'http';
    }
    const revision = revisionRef.current;
    try {
      const message = await saveAiSettingsToBackend(configToSave);
      const persisted = await loadAiSettingsFromBackend();
      // 清除标记只发一次；保存成功后复位，避免 localStorage/下次保存误清。
      const saved = {
        ...(persisted && hasPersistedAiSettings(persisted)
          ? mergePersistedAiSettings(configToSave, persisted) : {
            ...configToSave,
            hasApiKey: !configToSave.clearApiKey && (Boolean(configToSave.apiKey.trim()) || configToSave.hasApiKey === true),
            hasMcpApiKey: !configToSave.clearMcpApiKey && (Boolean(configToSave.mcpApiKey?.trim()) || configToSave.hasMcpApiKey === true),
          }),
        apiKey: '',
        mcpApiKey: '',
        clearApiKey: false,
        clearMcpApiKey: false,
      };
      saveAiServiceConfig(saved);
      setConfig((current) => revisionRef.current === revision ? saved : current);
      notify(message, 'success');
      return message;
    } catch (error) {
      // 后端拒绝（例如端点变化时空 key 不得沿用旧 key）必须可见，不能让用户以为已保存。
      const message = String(error).replace(/^Error:\s*/i, '');
      setSaveError(message);
      notify(message, 'error');
      throw error;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [notify, requestConfig, serviceType]);

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
