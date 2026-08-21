import { describe, expect, it } from 'vitest';
import { handlers } from './aiHandlers';

describe('mock AI service boundary', () => {
  it('keeps the local mock connection test deterministic', () => {
    expect(handlers.test_ai_connection?.({ serviceType: 'mock' })).toMatchObject({
      ok: true,
      service_type: 'mock',
    });
  });

  it('does not claim that browser mock mode tested an external service', () => {
    expect(handlers.test_ai_connection?.({
      serviceType: 'mcp',
      endpoint: 'http://127.0.0.1:8080/mcp',
    })).toMatchObject({
      ok: false,
      service_type: 'mcp',
    });
  });

  it('does not turn an external AI request into a fake mock success', () => {
    expect(() => handlers.ai_request?.({
      input: { operation: 'translate', service_type: 'http', text: 'hello' },
    })).toThrow(/不执行外部 AI\/MCP 网络请求/);
  });
});
