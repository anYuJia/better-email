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
  normalizeAiTimeoutSeconds,
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
   * keeps both connector credentials. Tests target this connector; ordinary
   * MCP saves select MCP, while shared switches preserve the saved route.
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
  throw new Error('旧版 AI 配置恢复失败，请重试。');
}

async function readAiSettingsWithRetry() {
  let lastError: unknown;
  for (const delay of AI_SETTINGS_MIGRATION_DELAYS_MS) {
    if (delay > 0) await waitForAiSettingsMigrationRetry(delay);
    try {
      return await loadAiSettingsFromBackend({ strict: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

type ConfigField = keyof AiServiceConfig;

function editsSince(current: AiServiceConfig, changes: Map<ConfigField, number>, revision: number): Partial<AiServiceConfig> {
  return Object.fromEntries([...changes].filter(([, changedAt]) => changedAt > revision)
    .map(([key]) => [key, current[key]]));
}

export default function useAiService({ setStatus, onNotify, serviceType }: UseAiServiceOptions) {
  const [config, setConfig] = useState<AiServiceConfig>(() => loadAiServiceConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestConnectionResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [secretsLoaded, setSecretsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const revisionRef = useRef(0);
  const testingRef = useRef(false);
  const savingRef = useRef(false);
  const persistedConfigRef = useRef(config);
  const changedFieldsRef = useRef(new Map<ConfigField, number>());
  const activeRef = useRef(false);
  const generationRef = useRef(0);

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
    activeRef.current = true;
    generationRef.current += 1;
    setSecretsLoaded(false);
    setLoadError(null);
    const hydrate = (report: NonNullable<Awaited<ReturnType<typeof loadAiSettingsFromBackend>>>) => {
      const persisted = mergePersistedAiSettings(persistedConfigRef.current, report);
      persistedConfigRef.current = persisted;
      saveAiServiceConfig(persisted);
      const pendingEdits = new Map(changedFieldsRef.current);
      setConfig((current) => ({ ...persisted, ...editsSince(current, pendingEdits, 0) }));
    };
    readAiSettingsWithRetry()
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
      .catch((error) => {
        if (!cancelled) setLoadError(`读取设置失败：${String(error).replace(/^Error:\s*/i, '')}`);
      });
    return () => {
      cancelled = true;
      activeRef.current = false;
    };
  }, [serviceType, reloadVersion]);

  // localStorage mirrors persisted settings only; cancelled guide drafts must
  // never become the runtime configuration in another window.

  const maskedApiKey = useMemo(() => maskApiKey(config.apiKey), [config.apiKey]);

  const patchConfig = useCallback((patch: Partial<AiServiceConfig>) => {
    revisionRef.current += 1;
    const normalizedPatch = {
      ...patch,
      ...(patch.apiKey?.trim() ? { clearApiKey: false } : {}),
      ...(patch.mcpApiKey?.trim() ? { clearMcpApiKey: false } : {}),
    };
    for (const field of Object.keys(normalizedPatch) as ConfigField[]) {
      if (Object.is(normalizedPatch[field], persistedConfigRef.current[field])) changedFieldsRef.current.delete(field);
      else changedFieldsRef.current.set(field, revisionRef.current);
    }
    setConfig((current) => ({
      ...current,
      ...normalizedPatch,
    }));
    setTestResult(null);
    setSaveError(null);
  }, []);

  const runTestConnection = useCallback(async () => {
    if (testingRef.current || savingRef.current || !secretsLoaded) return;
    testingRef.current = true;
    const revision = revisionRef.current;
    const generation = generationRef.current;
    setTesting(true);
    try {
      const result = await testAiConnection(requestConfig);
      if (!activeRef.current || generationRef.current !== generation || revisionRef.current !== revision) return;
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
      if (activeRef.current) setTesting(false);
    }
  }, [notify, requestConfig, secretsLoaded]);

  const saveConfig = useCallback(async (overrides: Partial<AiServiceConfig> = {}, { persistedOnly = false } = {}) => {
    if (!secretsLoaded) throw new Error('设置尚未读取完成，请稍候或重试。');
    if (savingRef.current) throw new Error('设置正在保存，请稍候。');
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const revision = revisionRef.current;
    const generation = generationRef.current;
    const draft = persistedOnly ? {} : editsSince(config, changedFieldsRef.current, 0);
    try {
      // Re-read just before saving. Unedited fields from the other connector
      // may have changed in another settings window.
      const latest = await loadAiSettingsFromBackend({ strict: true });
      const baseline = latest && hasPersistedAiSettings(latest)
        ? mergePersistedAiSettings(persistedConfigRef.current, latest) : persistedConfigRef.current;
      const configToSave: AiServiceConfig = {
        ...baseline,
        ...draft,
        ...(!persistedOnly && serviceType === 'mcp' ? { serviceType: 'mcp' as const } : {}),
        ...overrides,
      };
      configToSave.timeoutSeconds = normalizeAiTimeoutSeconds(configToSave.timeoutSeconds);
      if (configToSave.serviceType === 'mcp' && configToSave.mcpEnabled !== true) configToSave.serviceType = 'http';
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
      persistedConfigRef.current = saved;
      saveAiServiceConfig(saved);
      // Keep only edits made after this request (or all drafts for an immediate
      // shared switch), and discard submitted secrets and clear markers.
      if (activeRef.current && generationRef.current === generation) {
        const retainedEdits = new Map([...changedFieldsRef.current].filter(([field, changedAt]) => (
          changedAt > revision || (persistedOnly && !Object.prototype.hasOwnProperty.call(overrides, field))
        )));
        setConfig((current) => ({ ...saved, ...editsSince(current, retainedEdits, 0) }));
        if (!persistedOnly) {
          for (const [field, changedAt] of changedFieldsRef.current) {
            if (changedAt <= revision) changedFieldsRef.current.delete(field);
          }
        }
        for (const field of Object.keys(overrides) as ConfigField[]) {
          if ((changedFieldsRef.current.get(field) ?? 0) <= revision) changedFieldsRef.current.delete(field);
        }
        notify(message, 'success');
      }
      return message;
    } catch (error) {
      // 后端拒绝（例如端点变化时空 key 不得沿用旧 key）必须可见，不能让用户以为已保存。
      const message = String(error).replace(/^Error:\s*/i, '');
      if (activeRef.current && generationRef.current === generation) {
        setSaveError(message);
        notify(message, 'error');
      }
      throw error;
    } finally {
      savingRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  }, [config, notify, secretsLoaded, serviceType]);

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
    loadError,
    reloadConfig: () => setReloadVersion((version) => version + 1),
  };
}
