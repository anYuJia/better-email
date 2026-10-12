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
});
