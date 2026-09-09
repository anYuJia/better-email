import type {
  AiOperation,
  AiRequestError,
  AiRequestResult,
  AiServiceConfig,
  AiTestConnectionResult,
} from './types/ai';
import { loadEffectiveAiServiceConfig } from './aiServiceConfig';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

const MAX_INPUT_CHARS = 40_000;

/** Detect legacy offline payloads so they can never be rendered as a result. */
export function isOfflineAiResult(content: string): boolean {
  const normalized = content.trimStart();
  return normalized.startsWith('【mock ')
    || normalized.includes('Better Email 离线模拟')
    || normalized.includes('离线模拟摘要');
}

function truncateInput(text: string): string {
  return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
}

export function aiErrorMessage(error: AiRequestError): string {
  switch (error.kind) {
    case 'not_configured':
      return '请先配置 AI 服务（设置 > AI 接入）。';
    case 'disabled':
      return 'AI 服务已关闭，请先在设置中开启。';
    case 'mcp_disabled':
      return 'MCP 服务未开启，请先在设置中启用 MCP 服务。';
    case 'privacy_not_acknowledged':
      return '首次发送邮件内容到外部 AI 服务前，请先在设置 > AI 接入中阅读并确认隐私说明。';
    case 'external':
      return error.message;
  }
}

export function checkAiConfig(config: AiServiceConfig, external: boolean): AiRequestError | null {
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
  const result = await invoke<AiRequestResult>(IPC.AiRequest, { input });
  if (result.service_type !== config.serviceType || isOfflineAiResult(result.content)) {
    throw {
      kind: 'external',
      message: 'AI 请求返回了非真实服务结果，已拒绝显示；请检查桌面端版本和 AI 接入配置。',
    } satisfies AiRequestError;
  }
  return result;
}

export async function runAiOperation(
  operation: AiOperation,
  options: { text?: string; prompt?: string; targetLanguage?: string },
  config?: AiServiceConfig,
): Promise<AiRequestResult> {
  const resolved = config ?? await loadEffectiveAiServiceConfig();
  const gateError = checkAiConfig(resolved, true);
  if (gateError) {
    throw gateError;
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
    if (report.service_type !== config.serviceType || isOfflineAiResult(report.message)) {
      return {
        ok: false,
        message: '连接测试返回了非真实服务结果，已拒绝；请检查桌面端版本和 AI 接入配置。',
        latencyMs: report.latency_ms,
      };
    }
    return { ok: report.ok, message: report.message, latencyMs: report.latency_ms };
  } catch (error) {
    return { ok: false, message: `测试连接失败：${String(error)}`, latencyMs: 0 };
  }
}
