import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAiSettingsToBackend } from './aiServiceConfig';
import { defaultAiServiceConfig } from './aiServiceConfig';
import { IPC } from '../ipc/commands';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('../tauriBridge', () => ({
  invoke: invokeMock,
}));

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
