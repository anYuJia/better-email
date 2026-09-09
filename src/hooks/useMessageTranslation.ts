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
import type { AiRequestError } from '../app/types/ai';

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

const translationCache = new Map<string, string>();

export function cacheTranslation(key: string, content: string): void {
  translationCache.set(key, content);
}

export function getCachedTranslation(key: string): string | undefined {
  return translationCache.get(key);
}

export function clearTranslationCache(): void {
  translationCache.clear();
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

  const cacheKey = useMemo(() => (
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
    try {
      const result = await translateMessage(preparedSource.content, '中文');
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
  }, [message, needsTranslation, preparedSource, cacheKey, state.status, options.onError, options.setStatus]);

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
