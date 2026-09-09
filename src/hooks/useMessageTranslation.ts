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

const MAX_TRANSLATION_CACHE_ENTRIES = 64;
const translationCache = new Map<string, string>();

export function cacheTranslation(key: string, content: string): void {
  // Refresh insertion order so the map behaves as a tiny LRU instead of an
  // unbounded process-lifetime cache in a long-running mail client.
  translationCache.delete(key);
  translationCache.set(key, content);
  while (translationCache.size > MAX_TRANSLATION_CACHE_ENTRIES) {
    const oldest = translationCache.keys().next().value as string | undefined;
    if (!oldest) break;
    translationCache.delete(oldest);
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
}

function translationProviderFingerprint(config: AiServiceConfig, targetLanguage: string): string {
  const endpoint = config.serviceType === 'mcp'
    ? config.mcpEndpoint ?? ''
    : config.endpoint;
  return [
    config.serviceType,
    endpoint.trim().replace(/\/+$/, ''),
    config.defaultModel.trim(),
    targetLanguage.trim(),
  ].join('|');
}

export default function useMessageTranslation(
  message: Message | null,
  options: MessageTranslationOptions = {},
) {
  const [state, setState] = useState<MessageTranslationState>({
    messageId: null,
    status: 'idle',
    translation: '',
    format: 'plain',
    serviceType: '',
    error: '',
    showTranslation: false,
  });

  const assessment: TranslationAssessment | null = useMemo(() => {
    if (!message) return null;
    return assessTranslationNeed(message.body, message.sanitized_html);
  }, [message]);

  const sourceHtml = options.sourceHtml?.trim() || message?.sanitized_html.trim() || '';
  const preparedSource = useMemo(() => {
    if (!message) return null;
    return prepareTranslationSource(message.body, sourceHtml);
  }, [message?.body, sourceHtml]);

  const sourceFingerprint = useMemo(() => {
    if (!preparedSource) return '';
    let hash = 2166136261;
    for (let index = 0; index < preparedSource.content.length; index += 1) {
      hash ^= preparedSource.content.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${preparedSource.format}:${preparedSource.content.length}:${hash >>> 0}`;
  }, [preparedSource]);

  const messageCacheKey = useMemo(() => (
    message ? `${message.account_id}:${message.id}:${sourceFingerprint}` : null
  ), [message, sourceFingerprint]);

  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    setState((current) => {
      if (current.status === 'idle' && current.messageId === message?.id) return current;
      return {
        messageId: null,
        status: 'idle',
        translation: '',
        format: 'plain',
        serviceType: '',
        error: '',
        showTranslation: false,
      };
    });
  }, [message?.id, sourceFingerprint]);

  const needsTranslation = assessment !== null && assessment.foreign;

  const translate = useCallback(async () => {
    if (!message || !needsTranslation || !preparedSource) return;
    if (state.status === 'translating') return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    try {
      const aiConfig = await loadEffectiveAiServiceConfig();
      if (requestId !== requestIdRef.current) return;
      const providerFingerprint = translationProviderFingerprint(aiConfig, '中文');
      const cacheKey = messageCacheKey ? `${messageCacheKey}:${providerFingerprint}` : null;
      const cachedTranslation = cacheKey ? getCachedTranslation(cacheKey) : undefined;
      if (cachedTranslation !== undefined && !isOfflineAiResult(cachedTranslation)) {
        setState({
          messageId: message.id,
          status: 'success',
          translation: cachedTranslation,
          format: preparedSource.format,
          serviceType: 'cached',
          error: '',
          showTranslation: true,
        });
        return;
      }

      setState((current) => ({
        ...current,
        messageId: message.id,
        status: 'translating',
        format: preparedSource.format,
        serviceType: '',
        error: '',
      }));
      const result = await translateMessage(preparedSource.content, '中文', aiConfig);
      if (requestId !== requestIdRef.current) return;
      const restoredTranslation = preparedSource.restore(result.content);
      const translation = preparedSource.format === 'html'
        ? sanitizeTranslatedHtml(restoredTranslation)
        : restoredTranslation;
      if (cacheKey) cacheTranslation(cacheKey, translation);
      setState({
        messageId: message.id,
        status: 'success',
        translation,
        format: preparedSource.format,
        serviceType: result.service_type,
        error: '',
        showTranslation: true,
      });
      options.setStatus?.('已翻译为中文');
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      const errorMessage = aiErrorMessage(error as AiRequestError);
      setState((current) => ({
        ...current,
        messageId: message.id,
        status: 'failed',
        error: errorMessage,
      }));
      if (options.onError) options.onError(errorMessage);
      else options.setStatus?.(errorMessage);
    }
  }, [message, needsTranslation, preparedSource, messageCacheKey, state.status, options.onError, options.setStatus]);

  const toggleTranslation = useCallback(() => {
    if (state.status !== 'success') return;
    setState((current) => ({ ...current, showTranslation: !current.showTranslation }));
  }, [state.status]);

  const resetForMessage = useCallback(() => {
    requestIdRef.current += 1;
    setState({
      messageId: null,
      status: 'idle',
      translation: '',
      format: 'plain',
      serviceType: '',
      error: '',
      showTranslation: false,
    });
  }, []);

  return {
    assessment,
    needsTranslation,
    translationState: state,
    translate,
    toggleTranslation,
    resetForMessage,
  };
}
