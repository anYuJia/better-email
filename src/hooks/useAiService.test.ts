import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import useAiService from './useAiService';
import { aiServiceStorageKey } from '../app/aiServiceConfig';
import { IPC } from '../ipc/commands';
import { testAiConnection } from '../app/aiService';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('../tauriBridge', () => ({
  invoke: invokeMock,
}));

vi.mock('../app/aiService', () => ({
  testAiConnection: vi.fn(),
}));

function report(configured: boolean) {
  return {
    configured,
    enabled: true,
    service_type: 'http',
    endpoint: 'https://api.example.com/v1',
    has_api_key: false,
    model: 'deepseek-v4-flash',
    timeout_seconds: 30,
    privacy_acknowledged: true,
    mcp_enabled: false,
    mcp_endpoint: '',
    has_mcp_api_key: false,
  };
}

describe('useAiService', () => {
  afterEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    invokeMock.mockReset();
    vi.mocked(testAiConnection).mockReset();
    vi.restoreAllMocks();
  });

  it.each(['http', 'mcp'] as const)('migrates an enabled local mirror without changing its route on the %s page', async (serviceType) => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    window.localStorage.setItem(aiServiceStorageKey, JSON.stringify({
      enabled: true,
      serviceType: 'http',
      endpoint: 'https://api.example.com/v1',
      defaultModel: 'deepseek-v4-flash',
      timeoutSeconds: 30,
      privacyAcknowledged: true,
    }));

    let persisted = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === IPC.LoadAiSettings) return report(persisted);
      if (command === IPC.SaveAiSettings) {
        persisted = true;
        return 'AI 服务设置已保存。';
      }
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const { result } = renderHook(() => useAiService({ serviceType }));

    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    expect(persisted).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(IPC.SaveAiSettings, {
      input: expect.objectContaining({
        enabled: true,
        service_type: 'http',
        endpoint: 'https://api.example.com/v1',
        model: 'deepseek-v4-flash',
      }),
    });
    expect(result.current.config.enabled).toBe(true);
  });

  it('recovers a failed initial read without migrating over existing native settings', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    window.localStorage.setItem(aiServiceStorageKey, JSON.stringify({
      enabled: true,
      serviceType: 'http',
      endpoint: 'https://api.example.com/v1',
      privacyAcknowledged: true,
    }));

    let loadCount = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === IPC.LoadAiSettings) {
        loadCount += 1;
        if (loadCount === 1) throw new Error('MailStore 尚未就绪');
        return report(true);
      }
      if (command === IPC.SaveAiSettings) return 'AI 服务设置已保存。';
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const { result } = renderHook(() => useAiService({ serviceType: 'http' }));

    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    expect(invokeMock).not.toHaveBeenCalledWith(IPC.SaveAiSettings, expect.anything());
    expect(loadCount).toBeGreaterThanOrEqual(2);
  });

  it('keeps unsaved drafts out of the runtime mirror and resets clear markers on new tokens', async () => {
    invokeMock.mockResolvedValue(report(true));
    const { result } = renderHook(() => useAiService({ serviceType: 'mcp' }));
    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    act(() => result.current.patchConfig({ mcpEndpoint: 'https://draft.example/mcp', clearMcpApiKey: true }));
    act(() => result.current.patchConfig({ mcpApiKey: 'replacement-token' }));
    expect(result.current.config.clearMcpApiKey).toBe(false);
    const mirror = JSON.parse(window.localStorage.getItem(aiServiceStorageKey)!);
    expect(mirror.mcpEndpoint).toBe('');
    expect(JSON.stringify(mirror)).not.toContain('replacement-token');
  });

  it('discards a connection result after the configuration changes', async () => {
    invokeMock.mockResolvedValue(report(true));
    let resolveTest!: (value: { ok: boolean; message: string; latencyMs: number }) => void;
    vi.mocked(testAiConnection).mockImplementationOnce(() => new Promise((resolve) => { resolveTest = resolve; }));
    const onNotify = vi.fn();
    const { result } = renderHook(() => useAiService({ serviceType: 'mcp', onNotify }));
    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    let pending!: Promise<void>;
    act(() => { pending = result.current.runTestConnection(); });
    act(() => result.current.patchConfig({ mcpEndpoint: 'https://new.example/mcp' }));
    await act(async () => {
      resolveTest({ ok: true, message: 'old endpoint connected', latencyMs: 1 });
      await pending;
    });
    expect(result.current.testResult).toBeNull();
    expect(result.current.testing).toBe(false);
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('does not overwrite edits made while initial settings are loading', async () => {
    let resolveLoad!: (value: ReturnType<typeof report>) => void;
    invokeMock.mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const { result } = renderHook(() => useAiService({ serviceType: 'mcp' }));
    act(() => result.current.patchConfig({ mcpEndpoint: 'https://draft.example/mcp' }));
    await act(async () => { resolveLoad(report(true)); });
    expect(result.current.config.mcpEndpoint).toBe('https://draft.example/mcp');
    expect(JSON.parse(window.localStorage.getItem(aiServiceStorageKey)!).mcpEndpoint).toBe('');
  });

  it('uses a saved empty MCP endpoint instead of reviving a stale mirror', async () => {
    window.localStorage.setItem(aiServiceStorageKey, JSON.stringify({ mcpEndpoint: 'https://stale.example/mcp' }));
    invokeMock.mockResolvedValue(report(true));
    const { result } = renderHook(() => useAiService({ serviceType: 'mcp' }));
    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    expect(result.current.config.mcpEndpoint).toBe('');
  });

  it('keeps failed loads locked and allows an explicit retry without writing settings', async () => {
    invokeMock.mockRejectedValue(new Error('数据库暂时不可用'));
    const { result } = renderHook(() => useAiService({ serviceType: 'mcp' }));
    await waitFor(() => expect(result.current.loadError).toContain('数据库暂时不可用'), { timeout: 3000 });
    expect(result.current.secretsLoaded).toBe(false);
    await expect(result.current.saveConfig()).rejects.toThrow('尚未读取完成');
    expect(invokeMock).not.toHaveBeenCalledWith(IPC.SaveAiSettings, expect.anything());
    invokeMock.mockResolvedValue(report(true));
    act(() => result.current.reloadConfig());
    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    expect(result.current.loadError).toBeNull();
  });

  it('clears a submitted token while retaining edits made during the save', async () => {
    let stored = report(true);
    let resolveSave!: (message: string) => void;
    invokeMock.mockImplementation(async (command: string, args?: { input?: Record<string, unknown> }) => {
      if (command === IPC.LoadAiSettings) return stored;
      if (command === IPC.SaveAiSettings) {
        stored = { ...stored, has_api_key: true, model: String(args?.input?.model) };
        return new Promise((resolve) => { resolveSave = resolve; });
      }
    });
    const { result } = renderHook(() => useAiService({ serviceType: 'http' }));
    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    act(() => result.current.patchConfig({ apiKey: 'submitted-token' }));
    let pending!: Promise<string>;
    act(() => { pending = result.current.saveConfig(); });
    await waitFor(() => expect(resolveSave).toBeTypeOf('function'));
    act(() => result.current.patchConfig({ defaultModel: 'later-model' }));
    await act(async () => { resolveSave('已保存'); await pending; });
    expect(result.current.config.apiKey).toBe('');
    expect(result.current.config.hasApiKey).toBe(true);
    expect(result.current.config.defaultModel).toBe('later-model');
  });

  it('preserves another window’s MCP settings when saving HTTP model edits', async () => {
    let stored = { ...report(true), service_type: 'mcp', mcp_enabled: true, mcp_endpoint: 'https://old.example/mcp' };
    invokeMock.mockImplementation(async (command: string) => command === IPC.LoadAiSettings ? stored : '已保存');
    const { result } = renderHook(() => useAiService({ serviceType: 'http' }));
    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    act(() => result.current.patchConfig({ defaultModel: 'new-model' }));
    stored = { ...stored, mcp_endpoint: 'https://another-window.example/mcp' };
    await act(async () => { await result.current.saveConfig(); });
    expect(invokeMock).toHaveBeenCalledWith(IPC.SaveAiSettings, {
      input: expect.objectContaining({ model: 'new-model', service_type: 'mcp', mcp_endpoint: 'https://another-window.example/mcp' }),
    });
  });

  it('saves the shared AI gate without changing its connector or submitting drafts', async () => {
    let stored = { ...report(true), service_type: 'mcp', mcp_enabled: true, mcp_endpoint: 'https://example.com/mcp' };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === IPC.LoadAiSettings) return stored;
      stored = { ...stored, enabled: false };
      return '已保存';
    });
    const { result } = renderHook(() => useAiService({ serviceType: 'http' }));
    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    act(() => result.current.patchConfig({ apiKey: 'unsaved-token', defaultModel: 'unsaved-model', enabled: false }));
    await act(async () => { await result.current.saveConfig({ enabled: false }, { persistedOnly: true }); });
    expect(invokeMock).toHaveBeenCalledWith(IPC.SaveAiSettings, {
      input: expect.objectContaining({ enabled: false, service_type: 'mcp', api_key: '', model: 'deepseek-v4-flash' }),
    });
    expect(result.current.config.apiKey).toBe('unsaved-token');
    expect(result.current.config.defaultModel).toBe('unsaved-model');
    expect(result.current.config.enabled).toBe(false);
  });

  it('does not report a native save as failed when the local mirror is full', async () => {
    invokeMock.mockImplementation(async (command: string) => command === IPC.LoadAiSettings ? report(true) : '已保存');
    const onNotify = vi.fn();
    const { result } = renderHook(() => useAiService({ serviceType: 'http', onNotify }));
    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    await act(async () => { await result.current.saveConfig(); });
    expect(result.current.saveError).toBeNull();
    expect(onNotify).toHaveBeenCalledWith('已保存', 'success');
  });

  it('does not show notifications from a connection test after leaving the page', async () => {
    invokeMock.mockResolvedValue(report(true));
    let resolveTest!: (result: { ok: boolean; message: string }) => void;
    vi.mocked(testAiConnection).mockImplementationOnce(() => new Promise((resolve) => { resolveTest = resolve; }));
    const onNotify = vi.fn();
    const { result, unmount } = renderHook(() => useAiService({ serviceType: 'http', onNotify }));
    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    let pending!: Promise<void>;
    act(() => { pending = result.current.runTestConnection(); });
    unmount();
    await act(async () => { resolveTest({ ok: true, message: '旧页面连接成功' }); await pending; });
    expect(onNotify).not.toHaveBeenCalled();
  });
});
