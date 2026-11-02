import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '../app/types/message';
import {
  assessTranslationNeed,
  prepareTranslationSource,
  sanitizeTranslatedHtml,
  type TranslationAssessment,
  type TranslationSourceFormat,
} from '../app/translation';
import { aiErrorMessage, isOfflineAiResult, translateMessage } from '../app/aiService';
import { loadEffectiveAiServiceConfig } from '../app/aiServiceConfig';
import type { AiRequestError, AiServiceConfig } from '../app/types/ai';

export type TranslationStatus = 'idle' | 'translating' | 'success' | 'failed';
export type MessageTranslationFormat = TranslationSourceFormat;
export type MessageTranslationState = {
  messageId: number | null;
  status: TranslationStatus;
  translation: string;
  format: MessageTranslationFormat;
  serviceType: string;
  error: string;
  showTranslation: boolean;
};
type MessageTranslationOptions = {
  setStatus?: (status: string) => void;
  onError?: (message: string) => void;
  /** Use the already rendered HTML so inline attachment images stay usable. */
  sourceHtml?: string;
};
type TranslationSource = { key: string; messageId: number; body: string; html: string };
const idleState: MessageTranslationState = {
  messageId: null, status: 'idle', translation: '', format: 'plain', serviceType: '', error: '', showTranslation: false,
};
const translationCache = new Map<string, string>();
const translationSources = new Map<string, Pick<TranslationSource, 'body' | 'html'>>();
const MAX_CACHED_TRANSLATIONS = 20;

export function cacheTranslation(key: string, content: string): void {
  translationCache.delete(key);
  translationCache.set(key, content);
  while (translationCache.size > MAX_CACHED_TRANSLATIONS) {
    const oldest = translationCache.keys().next().value!;
    translationCache.delete(oldest);
    translationSources.delete(oldest);
  }
}
export function getCachedTranslation(key: string): string | undefined {
  const value = translationCache.get(key);
  if (value === undefined) return undefined;
  translationCache.delete(key);
  translationCache.set(key, value);
  return value;
}
export function clearTranslationCache(): void {
  translationCache.clear();
  translationSources.clear();
}

function translationProviderFingerprint(config: AiServiceConfig, targetLanguage: string): string {
  const endpoint = config.serviceType === 'mcp' ? config.mcpEndpoint ?? '' : config.endpoint;
  return JSON.stringify([
    config.serviceType,
    endpoint.trim().replace(/\/+$/, ''),
    config.defaultModel.trim(),
    targetLanguage.trim(),
  ]);
}

export default function useMessageTranslation(
  message: Message | null,
  options: MessageTranslationOptions = {},
) {
  const [state, setState] = useState<MessageTranslationState>(idleState);
  const source = useMemo<TranslationSource | null>(() => message ? {
    key: `${message.account_id}:${message.id}`, messageId: message.id,
    body: message.body, html: options.sourceHtml?.trim() || message.sanitized_html.trim() || '',
  } : null, [message?.account_id, message?.id, message?.body, message?.sanitized_html, options.sourceHtml]);
  const assessment: TranslationAssessment | null = useMemo(() => source
    ? assessTranslationNeed(source.body, source.html) : null, [source?.body, source?.html]);
  const preparedSource = useMemo(() => source
    ? prepareTranslationSource(source.body, source.html) : null, [source?.body, source?.html]);
  const activeSource = useRef(source);
  const stateSource = useRef<TranslationSource | null>(null);
  const generation = useRef(0);
  const pending = useRef<TranslationSource | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;
  if (activeSource.current !== source) {
    activeSource.current = source;
    generation.current += 1;
    pending.current = null;
  }
  useEffect(() => {
    stateSource.current = null;
    setState(idleState);
  }, [source]);
  useEffect(() => () => { generation.current += 1; }, []);

  const needsTranslation = assessment !== null && assessment.foreign;
  const translate = useCallback(async () => {
    if (!source || source !== activeSource.current || !needsTranslation || !preparedSource || pending.current === source) return;
    const request = ++generation.current;
    const isCurrent = () => request === generation.current && activeSource.current === source;
    stateSource.current = source;
    pending.current = source;
    setState({ ...idleState, messageId: source.messageId, status: 'translating', format: preparedSource.format });
    try {
      const aiConfig = await loadEffectiveAiServiceConfig();
      if (!isCurrent()) return;
      const cacheKey = `${source.key}:${translationProviderFingerprint(aiConfig, '中文')}`;
      const cachedSource = translationSources.get(cacheKey);
      // Compare exact source as well as provider/account identity. Tokenized
      // text alone omits image/link targets, including remote-image policy.
      const cached = cachedSource?.body === source.body && cachedSource.html === source.html
        ? getCachedTranslation(cacheKey) : undefined;
      if (cached !== undefined && !isOfflineAiResult(cached)) {
        setState({ messageId: source.messageId, status: 'success', translation: cached,
          format: preparedSource.format, serviceType: 'cached', error: '', showTranslation: true });
        return;
      }
      const result = await translateMessage(preparedSource.content, '中文', aiConfig);
      if (!isCurrent()) return;
      // Sanitize model-generated markup before restoring original, already
      // sanitized mail tags; the reader still owns their remote-content policy.
      const safeModelOutput = preparedSource.format === 'html'
        ? sanitizeTranslatedHtml(result.content) : result.content;
      const translation = preparedSource.restore(safeModelOutput);
      cacheTranslation(cacheKey, translation);
      translationSources.set(cacheKey, { body: source.body, html: source.html });
      setState({ messageId: source.messageId, status: 'success', translation,
        format: preparedSource.format, serviceType: result.service_type, error: '', showTranslation: true });
      callbacks.current.setStatus?.('已翻译为中文');
    } catch (error) {
      if (!isCurrent()) return;
      const errorMessage = aiErrorMessage(error as AiRequestError);
      setState({ ...idleState, messageId: source.messageId, status: 'failed', format: preparedSource.format, error: errorMessage });
      if (callbacks.current.onError) callbacks.current.onError(errorMessage);
      else callbacks.current.setStatus?.(errorMessage);
    } finally {
      if (isCurrent()) pending.current = null;
    }
  }, [source, needsTranslation, preparedSource]);

  const toggleTranslation = useCallback(() => {
    if (stateSource.current !== activeSource.current) return;
    setState((current) => current.status === 'success' ? { ...current, showTranslation: !current.showTranslation } : current);
  }, []);
  const resetForMessage = useCallback(() => {
    generation.current += 1;
    pending.current = null;
    stateSource.current = null;
    setState(idleState);
  }, []);

  return {
    assessment, needsTranslation,
    translationState: stateSource.current === source ? state : idleState,
    translate, toggleTranslation, resetForMessage,
  };
}
