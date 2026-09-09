import type { InvokeArgs, MockCommandHandler } from './types';

const BROWSER_AI_ERROR = '浏览器预览不执行真实 AI 请求，请在 Tauri 桌面应用中配置并调用真实 AI 服务。';

function rejectBrowserAiRequest(_args?: InvokeArgs): never {
  throw new Error(BROWSER_AI_ERROR);
}

function handleTestAiConnection(args?: InvokeArgs) {
  const serviceType = String(args?.serviceType ?? 'http').trim() === 'mcp' ? 'mcp' : 'http';
  return {
    ok: false,
    service_type: serviceType,
    message: BROWSER_AI_ERROR,
    latency_ms: 0,
  };
}

export const handlers: Record<string, MockCommandHandler> = {
  // Browser fixtures remain available for mail UI regression, but they must
  // never pretend to be an AI provider or return generated email content.
  'ai_request': rejectBrowserAiRequest,
  'ai_chat_request': rejectBrowserAiRequest,
  'test_ai_connection': handleTestAiConnection,
};
