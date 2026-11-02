import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultAiServiceConfig,
  loadAiSettingsFromBackend,
  normalizeAiTimeoutSeconds,
  saveAiSettingsToBackend,
  secretDraftLabel,
} from './aiServiceConfig';
import { IPC } from '../ipc/commands';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('../tauriBridge', () => ({ invoke: invokeMock }));
afterEach(() => invokeMock.mockReset());

describe('AI settings boundaries', () => {
  it('retains read errors in strict settings mode while keeping the runtime fallback', async () => {
    invokeMock.mockRejectedValue(new Error('数据库不可用'));
    await expect(loadAiSettingsFromBackend({ strict: true })).rejects.toThrow('数据库不可用');
    await expect(loadAiSettingsFromBackend()).resolves.toBeNull();
  });

  it.each([[1, 5], [999, 300], [30.7, 30], [NaN, 30], [Infinity, 30]])('normalizes timeout %s to %s', (value, expected) => {
    expect(normalizeAiTimeoutSeconds(value)).toBe(expected);
  });

  it('distinguishes saved credentials from pending replacement and removal', () => {
    expect(secretDraftLabel(true, '', false)).toBe('已保存');
    expect(secretDraftLabel(true, 'new-token', false)).toBe('待保存');
    expect(secretDraftLabel(false, '', true)).toBe('待清除');
    expect(secretDraftLabel(false, '', false)).toBe('未配置');
  });
});

describe('AI settings secret intent', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue('AI 服务设置已保存。');
  });

  it('never sends clear=true together with a replacement HTTP or MCP key', async () => {
    await saveAiSettingsToBackend({
      ...defaultAiServiceConfig,
      enabled: true,
      apiKey: 'sk-replacement',
      clearApiKey: true,
      mcpApiKey: 'mcp-replacement',
      clearMcpApiKey: true,
    });

    expect(invokeMock).toHaveBeenCalledWith(IPC.SaveAiSettings, {
      input: expect.objectContaining({
        api_key: 'sk-replacement',
        clear_api_key: false,
        mcp_api_key: 'mcp-replacement',
        clear_mcp_api_key: false,
      }),
    });
  });

  it('preserves an explicit clear intent when no replacement key is supplied', async () => {
    await saveAiSettingsToBackend({
      ...defaultAiServiceConfig,
      clearApiKey: true,
      clearMcpApiKey: true,
    });

    expect(invokeMock).toHaveBeenCalledWith(IPC.SaveAiSettings, {
      input: expect.objectContaining({
        api_key: '',
        clear_api_key: true,
        mcp_api_key: '',
        clear_mcp_api_key: true,
      }),
    });
  });
});
