export type AiServiceType = 'mcp' | 'http' | 'mock';

export type AiServiceConfig = {
  enabled: boolean;
  serviceType: AiServiceType;
  endpoint: string;
  apiKey: string;
  defaultModel: string;
  timeoutSeconds: number;
  privacyAcknowledged: boolean;
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
  | { kind: 'privacy_not_acknowledged' }
  | { kind: 'external'; message: string };
