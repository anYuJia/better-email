import { describe, expect, it, vi } from 'vitest';
import {
  aiErrorMessage,
  checkAiConfig,
  generateTemplate,
  mockAiResult,
  testAiConnection,
  translateMessage,
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
  it('mock translate returns stable deterministic result', async () => {
    const result = await translateMessage('Hello world', '中文', {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'mock',
    });
    expect(result.operation).toBe('translate');
    expect(result.service_type).toBe('mock');
    expect(result.content).toContain('Hello world');
    expect(result.content).toContain('mock 译文');
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
    const error = checkAiConfig({ ...defaultAiServiceConfig, enabled: false, serviceType: 'mock' }, false);
    expect(error?.kind).toBe('disabled');
  });

  it('does not report a disabled mock service as connected', async () => {
    await expect(testAiConnection({
      ...defaultAiServiceConfig,
      enabled: false,
      serviceType: 'mock',
    })).resolves.toMatchObject({ ok: false, message: expect.stringContaining('已关闭') });
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

    await expect(testAiConnection(config)).resolves.toMatchObject({ ok: true });
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

  it('mock generate_template returns template with variables', async () => {
    const result = await generateTemplate('给新客户发送产品介绍', {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'mock',
    });
    expect(result.operation).toBe('generate_template');
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content).toContain('{{contact.name}}');
  });

  it('mockAiResult builds content per operation', () => {
    expect(mockAiResult('translate', 'Hi', '', '中文').content).toContain('Hi');
    expect(mockAiResult('generate_template', '', '催款', '').content).toContain('{{contact.name}}');
    expect(mockAiResult('summarize', 'long body', '', '').content).toContain('long body');
  });

  it('maps error kinds to readable messages', () => {
    expect(aiErrorMessage({ kind: 'not_configured' })).toContain('请先配置 AI 服务');
    expect(aiErrorMessage({ kind: 'disabled' })).toContain('已关闭');
    expect(aiErrorMessage({ kind: 'privacy_not_acknowledged' })).toContain('隐私说明');
    expect(aiErrorMessage({ kind: 'external', message: 'boom' })).toBe('boom');
  });
});

describe('template generation chain', () => {
  it('generateTemplate mock output parses into subject and body', async () => {
    const result = await generateTemplate('向新客户介绍产品', {
      ...defaultAiServiceConfig,
      enabled: true,
      serviceType: 'mock',
    });
    const { parseAiGeneratedTemplate } = await import('./templateStore');
    const parsed = parseAiGeneratedTemplate(result.content);
    expect(parsed.subject).toBe('向新客户介绍产品跟进');
    expect(parsed.body).toContain('{{contact.name}}');
  });
});
