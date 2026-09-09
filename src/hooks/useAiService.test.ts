import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useAiService from './useAiService';
import { aiServiceStorageKey } from '../app/aiServiceConfig';
import { IPC } from '../ipc/commands';

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
  });

  it('migrates an enabled local mirror when the native backend has no saved row', async () => {
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

    const { result } = renderHook(() => useAiService({ serviceType: 'http' }));

    await waitFor(() => expect(result.current.secretsLoaded).toBe(true));
    expect(persisted).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(IPC.SaveAiSettings, {
      input: expect.objectContaining({
        enabled: true,
        endpoint: 'https://api.example.com/v1',
        model: 'deepseek-v4-flash',
      }),
    });
    expect(result.current.config.enabled).toBe(true);
  });

  it('retries migration when the native backend is not ready on the first read', async () => {
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
    expect(invokeMock).toHaveBeenCalledWith(IPC.SaveAiSettings, expect.anything());
    expect(loadCount).toBeGreaterThanOrEqual(2);
  });
});
