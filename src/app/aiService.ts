import type {
  AiOperation,
  AiRequestError,
  AiRequestResult,
  AiServiceConfig,
  AiTestConnectionResult,
} from './types/ai';
import { loadAiServiceConfig } from './aiServiceConfig';
import { mockMode, invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

const MAX_INPUT_CHARS = 40_000;

function truncateInput(text: string): string {
  return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
}

function mockTranslation(text: string, targetLanguage: string): string {
  const source = truncateInput(text).trim();
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
  const source = truncateInput(text).trim();
  if (!source) return '';
  const head = source.length > 300 ? `${source.slice(0, 300)}…` : source;
  return `【mock 摘要】\n${head}\n\n（离线模拟摘要，配置真实 AI 服务后可用。）`;
}

export function mockAiResult(operation: AiOperation, text: string, prompt: string, targetLanguage: string): AiRequestResult {
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
  }
  return { operation, content, service_type: 'mock', truncated: false };
}

export function aiErrorMessage(error: AiRequestError): string {
  switch (error.kind) {
    case 'not_configured':
      return '请先配置 AI 服务（设置 > AI 服务）。';
    case 'disabled':
      return 'AI 服务已关闭，请先在设置中开启。';
    case 'mcp_disabled':
      return 'MCP 服务未开启，请先在设置中启用 MCP 服务。';
    case 'privacy_not_acknowledged':
      return '首次发送邮件内容到外部 AI 服务前，请先在设置 > AI 服务中阅读并确认隐私说明。';
    case 'external':
      return error.message;
  }
}

export function checkAiConfig(config: AiServiceConfig, external: boolean): AiRequestError | null {
  if (config.serviceType === 'mock') {
    return config.enabled ? null : { kind: 'disabled' };
  }
  if (!config.enabled) return { kind: 'disabled' };
  if (config.serviceType === 'mcp' && config.mcpEnabled !== true) {
    return { kind: 'mcp_disabled' };
  }
  const endpoint = config.serviceType === 'mcp' ? config.mcpEndpoint ?? '' : config.endpoint;
  if (!endpoint.trim()) return { kind: 'not_configured' };
  if (external && !config.privacyAcknowledged) {
    return { kind: 'privacy_not_acknowledged' };
  }
  return null;
}

async function requestExternal(
  operation: AiOperation,
  text: string,
  prompt: string,
  targetLanguage: string,
  config: AiServiceConfig,
): Promise<AiRequestResult> {
  const isMcp = config.serviceType === 'mcp';
  const input = {
    operation,
    text: truncateInput(text),
    target_language: targetLanguage,
    prompt: truncateInput(prompt),
    endpoint: (isMcp ? config.mcpEndpoint ?? '' : config.endpoint).trim(),
    api_key: isMcp ? config.mcpApiKey ?? '' : config.apiKey,
    model: config.defaultModel.trim() || 'gpt-4o-mini',
    timeout_seconds: config.timeoutSeconds,
    service_type: config.serviceType,
  };
  return invoke<AiRequestResult>(IPC.AiRequest, { input });
}

export async function runAiOperation(
  operation: AiOperation,
  options: { text?: string; prompt?: string; targetLanguage?: string },
  config?: AiServiceConfig,
): Promise<AiRequestResult> {
  const resolved = config ?? loadAiServiceConfig();
  const external = resolved.serviceType !== 'mock';
  const gateError = checkAiConfig(resolved, external);
  if (gateError) {
    throw gateError;
  }
  if (!external) {
    return mockAiResult(
      operation,
      options.text ?? '',
      options.prompt ?? '',
      options.targetLanguage ?? '',
    );
  }
  return requestExternal(
    operation,
    options.text ?? '',
    options.prompt ?? '',
    options.targetLanguage ?? '',
    resolved,
  );
}

export function translateMessage(text: string, targetLanguage = '中文', config?: AiServiceConfig): Promise<AiRequestResult> {
  return runAiOperation('translate', { text, targetLanguage }, config);
}

export function generateTemplate(prompt: string, config?: AiServiceConfig): Promise<AiRequestResult> {
  return runAiOperation('generate_template', { prompt }, config);
}

export function summarizeMessage(text: string, config?: AiServiceConfig): Promise<AiRequestResult> {
  return runAiOperation('summarize', { text }, config);
}

export async function testAiConnection(config: AiServiceConfig): Promise<AiTestConnectionResult> {
  if (config.serviceType === 'mock') {
    const mockGateError = checkAiConfig(config, false);
    if (mockGateError) {
      return { ok: false, message: aiErrorMessage(mockGateError), latencyMs: 0 };
    }
    return { ok: true, message: '模拟 AI 服务连接正常（mock 模式不需要网络）。', latencyMs: 2 };
  }
  const gateError = checkAiConfig(config, false);
  if (gateError) {
    return { ok: false, message: aiErrorMessage(gateError), latencyMs: 0 };
  }
  const isMcp = config.serviceType === 'mcp';
  try {
    const report = await invoke<{ ok: boolean; service_type: string; message: string; latency_ms: number }>(
      IPC.TestAiConnection,
      {
        serviceType: config.serviceType,
        endpoint: (isMcp ? config.mcpEndpoint ?? '' : config.endpoint).trim(),
        apiKey: isMcp ? config.mcpApiKey ?? '' : config.apiKey,
        model: config.defaultModel.trim() || 'gpt-4o-mini',
        timeoutSeconds: config.timeoutSeconds,
      },
    );
    return { ok: report.ok, message: report.message, latencyMs: report.latency_ms };
  } catch (error) {
    return { ok: false, message: `测试连接失败：${String(error)}`, latencyMs: 0 };
  }
}

export function isAiExternal(config: AiServiceConfig): boolean {
  return config.serviceType !== 'mock';
}

export { mockMode };
