import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Message } from '../app/types/message';
import { assessTranslationNeed, extractPlainText, type TranslationAssessment } from '../app/translation';
import { aiErrorMessage, translateMessage } from '../app/aiService';
import type { AiRequestError } from '../app/types/ai';

export type TranslationStatus = 'idle' | 'translating' | 'success' | 'failed';

export type MessageTranslationState = {
  messageId: number | null;
  status: TranslationStatus;
  translation: string;
  error: string;
  showTranslation: boolean;
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
  options: { setStatus?: (status: string) => void } = {},
) {
  const [state, setState] = useState<MessageTranslationState>({
    messageId: null,
    status: 'idle',
    translation: '',
    error: '',
    showTranslation: false,
  });

  const assessment: TranslationAssessment | null = useMemo(() => {
    if (!message) return null;
    return assessTranslationNeed(message.body, message.sanitized_html);
  }, [message]);

  const cacheKey = useMemo(() => (
    message ? `${message.account_id}:${message.id}` : null
  ), [message]);

  useEffect(() => {
    setState((current) => {
      if (current.status === 'idle' && current.messageId === message?.id) return current;
      return { messageId: null, status: 'idle', translation: '', error: '', showTranslation: false };
    });
  }, [message?.id]);

  const needsTranslation = assessment !== null && assessment.foreign;

  const translate = useCallback(async () => {
    if (!message || !needsTranslation) return;
    if (state.status === 'translating') return;
    if (cacheKey && getCachedTranslation(cacheKey)) {
      setState({
        messageId: message.id,
        status: 'success',
        translation: getCachedTranslation(cacheKey)!,
        error: '',
        showTranslation: true,
      });
      return;
    }
    setState((current) => ({ ...current, messageId: message.id, status: 'translating', error: '' }));
    try {
      const source = extractPlainText(message.body, message.sanitized_html);
      const result = await translateMessage(source, '中文');
      if (cacheKey) cacheTranslation(cacheKey, result.content);
      setState({
        messageId: message.id,
        status: 'success',
        translation: result.content,
        error: '',
        showTranslation: true,
      });
      options.setStatus?.('已翻译为中文');
    } catch (error) {
      setState((current) => ({
        ...current,
        messageId: message.id,
        status: 'failed',
        error: aiErrorMessage(error as AiRequestError),
      }));
    }
  }, [message, needsTranslation, cacheKey, state.status, options]);

  const toggleTranslation = useCallback(() => {
    if (state.status !== 'success') return;
    setState((current) => ({ ...current, showTranslation: !current.showTranslation }));
  }, [state.status]);

  const resetForMessage = useCallback(() => {
    setState({ messageId: null, status: 'idle', translation: '', error: '', showTranslation: false });
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
