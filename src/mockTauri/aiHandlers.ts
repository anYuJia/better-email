import type { InvokeArgs, MockCommandHandler } from './types';

function mockTranslation(text: string, targetLanguage: string): string {
  const source = text.trim();
  if (!source) return '';
  const head = source.length > 200 ? `${source.slice(0, 200)}…` : source;
  const target = targetLanguage.trim() || '中文';
  return `【mock 译文 · ${target}】\n${head}\n\n（这是 Better Email 离线模拟的稳定翻译结果，配置真实 AI 服务后可获得完整译文。）`;
}

function mockGeneratedTemplate(prompt: string): string {
  const topic = prompt.trim() || '通用商务邮件';
  return `主题：${topic}跟进\n\n正文：\n您好 {{contact.name}}，\n\n感谢您对 ${topic} 的关注。我们希望确认接下来的安排，如您有任何疑问，请随时回复。\n\n祝好，\n{{account.email}}`;
}

function mockSummary(text: string): string {
  const source = text.trim();
  if (!source) return '';
  const head = source.length > 300 ? `${source.slice(0, 300)}…` : source;
  return `【mock 摘要】\n${head}\n\n（离线模拟摘要，配置真实 AI 服务后可用。）`;
}

function handleAiRequest(args?: InvokeArgs) {
  const input = (args?.input ?? {}) as {
    operation?: string;
    text?: string;
    target_language?: string;
    prompt?: string;
    service_type?: string;
  };
  if (input.service_type && input.service_type !== 'mock') {
    throw new Error('当前为浏览器 mock 环境，不执行外部 AI/MCP 网络请求；请在 Tauri 桌面应用中运行。');
  }
  const operation = input.operation ?? 'translate';
  const text = String(input.text ?? '');
  const prompt = String(input.prompt ?? '');
  const targetLanguage = String(input.target_language ?? '');
  let content = '';
  switch (operation) {
    case 'translate':
      content = mockTranslation(text, targetLanguage);
      break;
    case 'generate_template':
      content = mockGeneratedTemplate(prompt);
      break;
    case 'summarize':
      content = mockSummary(text);
      break;
    default:
      content = `【mock ${operation}】\n${text || prompt}`;
  }
  return {
    operation,
    content,
    service_type: 'mock',
    truncated: false,
  };
}

function handleAiChatRequest(args?: InvokeArgs) {
  const input = (args?.input ?? {}) as { messages?: Array<{ content?: string }> };
  const lastUser = [...(input.messages ?? [])].reverse().find((message) => message.content);
  return {
    content: `【mock 回复】${lastUser?.content?.slice(0, 80) ?? ''}`,
    model: 'mock-model',
    latency_ms: 3,
  };
}

function handleTestAiConnection(args?: InvokeArgs) {
  const serviceType = String(args?.serviceType ?? 'mock');
  if (serviceType !== 'mock') {
    return {
      ok: false,
      service_type: serviceType,
      message: '当前为浏览器 mock 环境，不执行外部 AI/MCP 网络连接测试；请在 Tauri 桌面应用中测试。',
      latency_ms: 0,
    };
  }
  return {
    ok: true,
    service_type: 'mock',
    message: '模拟 AI 服务连接正常（mock 模式不需要网络）。',
    latency_ms: 2,
  };
}

export const handlers: Record<string, MockCommandHandler> = {
  'ai_request': handleAiRequest,
  'ai_chat_request': handleAiChatRequest,
  'test_ai_connection': handleTestAiConnection,
};
