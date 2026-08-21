export type AiServiceType = 'mcp' | 'http' | 'mock';

export type AiServiceConfig = {
  enabled: boolean;
  serviceType: AiServiceType;
  endpoint: string;
  /** 用户新输入的 API Key（空值表示保持后端已保存的密钥）。 */
  apiKey: string;
  defaultModel: string;
  timeoutSeconds: number;
  privacyAcknowledged: boolean;
  /** 后端是否已保存 API Key / MCP Key。 */
  hasApiKey?: boolean;
  hasMcpApiKey?: boolean;
  clearApiKey?: boolean;
  clearMcpApiKey?: boolean;
  /* Parallel MCP Server Gateway Configuration */
  mcpEnabled?: boolean;
  mcpEndpoint?: string;
  mcpApiKey?: string;
};

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiChatCompletionInput = {
  messages: AiChatMessage[];
  model: string;
  temperature?: number;
};

export type AiChatCompletionResult = {
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export type AiTestConnectionResult = {
  ok: boolean;
  message: string;
  latencyMs?: number;
};

export type AiOperation = 'translate' | 'generate_template' | 'summarize';

export type AiRequestResult = {
  operation: AiOperation;
  content: string;
  service_type: string;
  truncated: boolean;
};

export type AiRequestError =
  | { kind: 'not_configured' }
  | { kind: 'disabled' }
  | { kind: 'mcp_disabled' }
  | { kind: 'privacy_not_acknowledged' }
  | { kind: 'external'; message: string };
