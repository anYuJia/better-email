import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
type TranslationSource = { key: string; messageId: number; body: string; html: string };
const idleState: MessageTranslationState = {
  messageId: null, status: 'idle', translation: '', error: '', showTranslation: false,
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
  return translationCache.get(key);
}
export function clearTranslationCache(): void {
  translationCache.clear();
  translationSources.clear();
}

export default function useMessageTranslation(
  message: Message | null,
  options: { setStatus?: (status: string) => void } = {},
) {
  const [state, setState] = useState<MessageTranslationState>(idleState);
  const source = useMemo<TranslationSource | null>(() => message ? {
    key: `${message.account_id}:${message.id}`, messageId: message.id,
    body: message.body, html: message.sanitized_html,
  } : null, [message?.account_id, message?.id, message?.body, message?.sanitized_html]);
  const assessment: TranslationAssessment | null = useMemo(() => source
    ? assessTranslationNeed(source.body, source.html) : null, [source?.body, source?.html]);
  const activeSource = useRef(source);
  const stateSource = useRef<TranslationSource | null>(null);
  const generation = useRef(0);
  const pending = useRef<TranslationSource | null>(null);
  const setStatusRef = useRef(options.setStatus);
  setStatusRef.current = options.setStatus;
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
    if (!source || source !== activeSource.current || !needsTranslation || pending.current === source) return;
    const request = ++generation.current;
    const isCurrent = () => request === generation.current && activeSource.current === source;
    const cachedSource = translationSources.get(source.key);
    const cached = cachedSource?.body === source.body && cachedSource.html === source.html
      ? getCachedTranslation(source.key) : undefined;
    stateSource.current = source;
    if (cached) {
      setState({ messageId: source.messageId, status: 'success', translation: cached, error: '', showTranslation: true });
      return;
    }
    pending.current = source;
    setState({ ...idleState, messageId: source.messageId, status: 'translating' });
    try {
      const result = await translateMessage(extractPlainText(source.body, source.html), '中文');
      if (!isCurrent()) return;
      cacheTranslation(source.key, result.content);
      translationSources.set(source.key, { body: source.body, html: source.html });
      setState({ messageId: source.messageId, status: 'success', translation: result.content, error: '', showTranslation: true });
      setStatusRef.current?.('已翻译为中文');
    } catch (error) {
      if (!isCurrent()) return;
      setState({ ...idleState, messageId: source.messageId, status: 'failed', error: aiErrorMessage(error as AiRequestError) });
    } finally {
      if (isCurrent()) pending.current = null;
    }
  }, [source, needsTranslation]);

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
