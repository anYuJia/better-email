import { describe, expect, it } from 'vitest';
import { handlers } from './aiHandlers';

describe('browser AI service boundary', () => {
  it('does not report a browser HTTP connection as successful', () => {
    expect(handlers.test_ai_connection?.({ serviceType: 'http' })).toMatchObject({
      ok: false,
      service_type: 'http',
    });
  });

  it('does not claim that browser MCP mode tested an external service', () => {
    expect(handlers.test_ai_connection?.({
      serviceType: 'mcp',
      endpoint: 'http://127.0.0.1:8080/mcp',
    })).toMatchObject({
      ok: false,
      service_type: 'mcp',
    });
  });

  it('does not turn an external AI request into a fake success', () => {
    expect(() => handlers.ai_request?.({
      input: { operation: 'translate', service_type: 'http', text: 'hello' },
    })).toThrow(/浏览器预览不执行真实 AI 请求/);
  });
});
