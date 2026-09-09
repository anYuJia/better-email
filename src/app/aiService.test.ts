import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aiErrorMessage,
  checkAiConfig,
  generateTemplate,
  splitAiInput,
  testAiConnection,
  translateMessage,
  validateAiEndpointForRequest,
} from './aiService';
import { defaultAiServiceConfig } from './aiServiceConfig';
import type { AiServiceConfig } from './types/ai';
import { IPC } from '../ipc/commands';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('../tauriBridge', () => ({
  invoke: invokeMock,
  mockMode: true,
}));

describe('aiService', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('throws clear error when AI service is not configured', async () => {
    const config: AiServiceConfig = {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'http',
      endpoint: '',
    };
    await expect(translateMessage('hello', '中文', config)).rejects.toMatchObject({
      kind: 'not_configured',
    });
  });

  it('throws clear error when disabled', () => {
    const error = checkAiConfig({ ...defaultAiServiceConfig, enabled: false, serviceType: 'http' }, false);
    expect(error?.kind).toBe('disabled');
  });

  it('does not provide an offline result when AI is not configured', async () => {
    await expect(translateMessage('hello', '中文', {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'http',
      endpoint: '',
    })).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('uses the MCP endpoint and reports a dedicated disabled error', () => {
    const config: AiServiceConfig = {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'mcp',
      endpoint: 'https://wrong.example.com/v1',
      mcpEndpoint: 'http://127.0.0.1:8080/mcp',
      mcpEnabled: false,
    };
    expect(checkAiConfig(config, true)).toMatchObject({ kind: 'mcp_disabled' });
    expect(aiErrorMessage({ kind: 'mcp_disabled' })).toContain('MCP 服务未开启');
    expect(checkAiConfig({ ...config, mcpEnabled: true }, true)).toMatchObject({
      kind: 'privacy_not_acknowledged',
    });
  });

  it('routes MCP operations to the MCP endpoint and token', async () => {
    invokeMock.mockResolvedValueOnce({
      operation: 'translate',
      content: '你好',
      service_type: 'mcp',
      truncated: false,
    });
    const config: AiServiceConfig = {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'mcp',
      endpoint: 'https://wrong.example.com/v1',
      apiKey: 'wrong-key',
      mcpEnabled: true,
      mcpEndpoint: 'http://127.0.0.1:8080/mcp',
      mcpApiKey: 'mcp-token',
      privacyAcknowledged: true,
    };

    await expect(translateMessage('hello', '中文', config)).resolves.toMatchObject({
      service_type: 'mcp',
    });
    expect(invokeMock).toHaveBeenCalledWith('ai_request', {
      input: expect.objectContaining({
        endpoint: 'http://127.0.0.1:8080/mcp',
        api_key: 'mcp-token',
        service_type: 'mcp',
      }),
    });
  });

  it('tests MCP connections with the MCP endpoint and token', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      service_type: 'mcp',
      message: 'MCP 服务连接正常。',
      latency_ms: 4,
    });
    const config: AiServiceConfig = {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'mcp',
      mcpEnabled: true,
      mcpEndpoint: 'http://127.0.0.1:8080/mcp',
      mcpApiKey: 'mcp-token',
      privacyAcknowledged: true,
    };

    await expect(testAiConnection(config)).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining('协议握手'),
    });
    expect(invokeMock).toHaveBeenCalledWith(IPC.TestAiConnection, expect.objectContaining({
      serviceType: 'mcp',
      endpoint: 'http://127.0.0.1:8080/mcp',
      apiKey: 'mcp-token',
    }));
  });

  it('requires privacy acknowledgment before external sends', () => {
    const config: AiServiceConfig = {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'http',
      endpoint: 'https://api.example.com/v1',
      privacyAcknowledged: false,
    };
    const error = checkAiConfig(config, true);
    expect(error?.kind).toBe('privacy_not_acknowledged');
    expect(checkAiConfig(config, false)).toBeNull();
  });

  it('hydrates runtime requests from the saved backend provider', async () => {
    invokeMock
      .mockResolvedValueOnce({
        configured: true,
        enabled: true,
        service_type: 'http',
        endpoint: 'https://api.example.com/v1',
        has_api_key: true,
        model: 'deepseek-v4-flash',
        timeout_seconds: 30,
        privacy_acknowledged: true,
        mcp_enabled: false,
        mcp_endpoint: '',
        has_mcp_api_key: false,
      })
      .mockResolvedValueOnce({
        operation: 'translate',
        content: '你好',
        service_type: 'http',
        truncated: false,
      });

    await expect(translateMessage('hello', '中文')).resolves.toMatchObject({
      content: '你好',
      service_type: 'http',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(1, IPC.LoadAiSettings);
    expect(invokeMock).toHaveBeenNthCalledWith(2, IPC.AiRequest, {
      input: expect.objectContaining({
        endpoint: 'https://api.example.com/v1',
        api_key: '',
        model: 'deepseek-v4-flash',
        service_type: 'http',
      }),
    });
  });

  it('rejects a non-provider response when the request was routed externally', async () => {
    invokeMock.mockResolvedValueOnce({
      operation: 'translate',
      content: 'fake',
      service_type: 'legacy',
      truncated: false,
    });
    const config: AiServiceConfig = {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'http',
      endpoint: 'https://api.example.com/v1',
      privacyAcknowledged: true,
    };

    await expect(translateMessage('hello', '中文', config)).rejects.toMatchObject({
      kind: 'external',
      message: expect.stringContaining('非真实服务'),
    });
  });

  it('rejects legacy offline text even when an old backend labels it as http', async () => {
    invokeMock.mockResolvedValueOnce({
      operation: 'translate',
      content: '【mock 译文 · 中文】\nhello',
      service_type: 'http',
      truncated: false,
    });
    const config: AiServiceConfig = {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'http',
      endpoint: 'https://api.example.com/v1',
      privacyAcknowledged: true,
    };

    await expect(translateMessage('hello', '中文', config)).rejects.toMatchObject({
      kind: 'external',
      message: expect.stringContaining('非真实服务'),
    });
  });

  it('maps error kinds to readable messages', () => {
    expect(aiErrorMessage({ kind: 'not_configured' })).toContain('请先配置 AI 服务');
    expect(aiErrorMessage({ kind: 'disabled' })).toContain('已关闭');
    expect(aiErrorMessage({ kind: 'privacy_not_acknowledged' })).toContain('隐私说明');
    expect(aiErrorMessage({ kind: 'external', message: 'boom' })).toBe('boom');
  });

  it('rejects legacy completions and query-string endpoints instead of misrouting requests', () => {
    expect(() => validateAiEndpointForRequest('https://api.example.com/v1/completions'))
      .toThrow(expect.objectContaining({ kind: 'external' }));
    expect(() => validateAiEndpointForRequest('https://api.example.com/v1?api-version=1'))
      .toThrow(expect.objectContaining({ kind: 'external' }));
    expect(validateAiEndpointForRequest('https://api.example.com/v1/chat/completions'))
      .toBe('https://api.example.com/v1/chat/completions');
  });

  it('splits long translation input without cutting protected HTML tokens', () => {
    const token = '__BETTER_EMAIL_TAG_123__';
    const source = `${'a'.repeat(19_990)}${token}${'b'.repeat(21_000)}`;
    const chunks = splitAiInput(source, 20_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(source);
    expect(chunks.some((chunk) => chunk.endsWith('__BETTER_EMAIL_TA'))).toBe(false);
    expect(chunks.some((chunk) => chunk.startsWith('G_123__'))).toBe(false);
  });

  it('translates long input in multiple real-provider requests instead of silently truncating', async () => {
    invokeMock
      .mockResolvedValueOnce({ operation: 'translate', content: '甲', service_type: 'http', truncated: false })
      .mockResolvedValueOnce({ operation: 'translate', content: '乙', service_type: 'http', truncated: false });
    const config: AiServiceConfig = {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'http',
      endpoint: 'https://api.example.com/v1',
      privacyAcknowledged: true,
    };
    const source = `${'x'.repeat(19_000)}\n${'y'.repeat(19_000)}`;

    const result = await translateMessage(source, '中文', config);

    expect(result.content).toBe('甲乙');
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, IPC.AiRequest, expect.objectContaining({
      input: expect.objectContaining({ operation: 'translate' }),
    }));
    expect(invokeMock).toHaveBeenNthCalledWith(2, IPC.AiRequest, expect.objectContaining({
      input: expect.objectContaining({ operation: 'translate' }),
    }));
  });

  it('rejects truncated provider output instead of rendering an incomplete result', async () => {
    invokeMock.mockResolvedValueOnce({
      operation: 'translate',
      content: 'partial',
      service_type: 'http',
      truncated: true,
    });
    const config: AiServiceConfig = {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'http',
      endpoint: 'https://api.example.com/v1',
      privacyAcknowledged: true,
    };
    await expect(translateMessage('hello', '中文', config)).rejects.toMatchObject({
      kind: 'external',
      message: expect.stringContaining('不完整结果'),
    });
  });
});

describe('template generation chain', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('generateTemplate result parses into subject and body', async () => {
    invokeMock.mockResolvedValueOnce({
      operation: 'generate_template',
      content: '主题：向新客户介绍产品跟进\n\n正文：\n您好 {{contact.name}}',
      service_type: 'http',
      truncated: false,
    });
    const result = await generateTemplate('向新客户介绍产品', {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'http',
      endpoint: 'https://api.example.com/v1',
      privacyAcknowledged: true,
    });
    const { parseAiGeneratedTemplate } = await import('./templateStore');
    const parsed = parseAiGeneratedTemplate(result.content);
    expect(parsed.subject).toBe('向新客户介绍产品跟进');
    expect(parsed.body).toContain('{{contact.name}}');
  });
});
