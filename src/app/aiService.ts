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
const MAX_AI_CHUNK_CHARS = 20_000;
const CHUNK_BOUNDARY_LOOKBACK = 2_000;
const PROTECTED_TOKEN_PREFIX = '__BETTER_EMAIL_';

/** Detect legacy offline payloads so they can never be rendered as a result. */
export function isOfflineAiResult(content: string): boolean {
  const normalized = content.trimStart();
  return normalized.startsWith('【mock ')
    || normalized.includes('Better Email 离线模拟')
    || normalized.includes('离线模拟摘要');
}

function externalError(message: string): AiRequestError {
  return { kind: 'external', message };
}

/**
 * Validate endpoint shapes before IPC. Query parameters are intentionally
 * allowed because the Rust URL normalizer preserves them for OpenAI-compatible
 * gateways; URL fragments and legacy `/completions` are not valid targets.
 */
export function validateAiEndpointForRequest(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw externalError('AI 服务地址不是合法 URL，请检查协议、主机和路径。');
  }
  if (parsed.hash) {
    throw externalError('AI 服务地址不允许包含 URL 片段（#...）。');
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path.endsWith('/completions') && !path.endsWith('/chat/completions')) {
    throw externalError('当前接入使用 Chat Completions 协议，请填写 /chat/completions 或其上级基础地址，不能使用旧的 /completions。');
  }
  return trimmed;
}

function protectedTokenCrossesBoundary(text: string, start: number, end: number): number | null {
  const tokenStart = text.lastIndexOf(PROTECTED_TOKEN_PREFIX, end);
  if (tokenStart < start) return null;
  const tokenEnd = text.indexOf('__', tokenStart + PROTECTED_TOKEN_PREFIX.length);
  if (tokenEnd < 0 || tokenEnd + 2 > end) return tokenStart;
  return null;
}

function safeChunkEnd(text: string, start: number, maxChars: number): number {
  const hardEnd = Math.min(text.length, start + maxChars);
  if (hardEnd >= text.length) return text.length;

  const tokenBoundary = protectedTokenCrossesBoundary(text, start, hardEnd);
  const candidateEnd = tokenBoundary !== null && tokenBoundary > start
    ? tokenBoundary
    : hardEnd;
  const floor = Math.max(start + 1, candidateEnd - CHUNK_BOUNDARY_LOOKBACK);
  const newline = text.lastIndexOf('\n', candidateEnd - 1);
  if (newline >= floor) return newline + 1;
  const whitespace = Math.max(
    text.lastIndexOf(' ', candidateEnd - 1),
    text.lastIndexOf('\t', candidateEnd - 1),
  );
  if (whitespace >= floor) return whitespace + 1;
  return candidateEnd > start ? candidateEnd : hardEnd;
}

/** Split large AI input without cutting protected translation tokens. */
export function splitAiInput(text: string, maxChars = MAX_AI_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = safeChunkEnd(text, start, maxChars);
    if (end <= start) {
      throw externalError('AI 输入分块失败，请缩短邮件内容后重试。');
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
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
  if (text.length > MAX_INPUT_CHARS || prompt.length > MAX_INPUT_CHARS) {
    throw externalError('AI 单次请求内容过长，已拒绝静默截断；请使用分块处理或缩短提示词。');
  }
  const isMcp = config.serviceType === 'mcp';
  const endpoint = validateAiEndpointForRequest(
    (isMcp ? config.mcpEndpoint ?? '' : config.endpoint).trim(),
  );
  const input = {
    operation,
    text,
    target_language: targetLanguage,
    prompt,
    endpoint,
    api_key: isMcp ? config.mcpApiKey ?? '' : config.apiKey,
    model: config.defaultModel.trim() || 'gpt-4o-mini',
    timeout_seconds: config.timeoutSeconds,
    service_type: config.serviceType,
  };
  const result = await invoke<AiRequestResult>(IPC.AiRequest, { input });
  if (result.service_type !== config.serviceType || isOfflineAiResult(result.content)) {
    throw externalError('AI 请求返回了非真实服务结果，已拒绝显示；请检查桌面端版本和 AI 接入配置。');
  }
  if (result.truncated) {
    throw externalError('AI 服务返回内容超过安全上限，已拒绝显示不完整结果；请缩短内容后重试。');
  }
  return result;
}

async function translateLargeText(
  text: string,
  targetLanguage: string,
  config: AiServiceConfig,
): Promise<AiRequestResult> {
  const chunks = splitAiInput(text);
  if (chunks.length === 1) {
    return requestExternal('translate', chunks[0], '', targetLanguage, config);
  }
  const translated: string[] = [];
  for (const chunk of chunks) {
    const result = await requestExternal('translate', chunk, '', targetLanguage, config);
    translated.push(result.content);
  }
  return {
    operation: 'translate',
    service_type: config.serviceType,
    content: translated.join(''),
    truncated: false,
  };
}

async function summarizeLargeText(
  text: string,
  config: AiServiceConfig,
): Promise<AiRequestResult> {
  const chunks = splitAiInput(text);
  if (chunks.length === 1) {
    return requestExternal('summarize', chunks[0], '', '', config);
  }
  const partials: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const result = await requestExternal(
      'summarize',
      `这是长邮件的第 ${index + 1}/${chunks.length} 部分。\n\n${chunks[index]}`,
      '',
      '',
      config,
    );
    partials.push(result.content.trim());
  }
  const synthesis = partials
    .map((part, index) => `第 ${index + 1} 部分摘要：\n${part}`)
    .join('\n\n');
  if (synthesis.length > MAX_INPUT_CHARS) {
    throw externalError('长邮件分段摘要仍超过合并上限，请缩小邮件范围后重试。');
  }
  return requestExternal(
    'summarize',
    `请将以下分段摘要合并为一份完整、去重的中文摘要，并保留关键待办事项。\n\n${synthesis}`,
    '',
    '',
    config,
  );
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
  const text = options.text ?? '';
  const prompt = options.prompt ?? '';
  const targetLanguage = options.targetLanguage ?? '';
  if (operation === 'translate') {
    return translateLargeText(text, targetLanguage, resolved);
  }
  if (operation === 'summarize') {
    return summarizeLargeText(text, resolved);
  }
  if (prompt.length > MAX_INPUT_CHARS) {
    throw externalError('模板生成提示词过长，已拒绝静默截断；请缩短提示词后重试。');
  }
  return requestExternal(operation, text, prompt, targetLanguage, resolved);
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
    const endpoint = validateAiEndpointForRequest(
      (isMcp ? config.mcpEndpoint ?? '' : config.endpoint).trim(),
    );
    const report = await invoke<{ ok: boolean; service_type: string; message: string; latency_ms: number }>(
      IPC.TestAiConnection,
      {
        serviceType: config.serviceType,
        endpoint,
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
    const message = typeof error === 'object' && error !== null && 'kind' in error
      ? aiErrorMessage(error as AiRequestError)
      : String(error);
    return { ok: false, message: `测试连接失败：${message}`, latencyMs: 0 };
  }
}
