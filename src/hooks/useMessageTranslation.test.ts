import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useMessageTranslation, { clearTranslationCache } from './useMessageTranslation';
import * as aiService from '../app/aiService';
import type { AiRequestResult } from '../app/types/ai';
import { aiServiceStorageKey } from '../app/aiServiceConfig';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
  getCurrentWindow: () => ({
    setBadgeCount: async () => undefined,
    setBadgeLabel: async () => undefined,
    onDragDropEvent: async () => () => undefined,
  }),
  mockMode: false,
}));

function englishMessage(id: number) {
  return {
    id,
    account_id: 1,
    subject: `Message ${id}`,
    body: `Hello from English sender ${id}, please review the attached quote.`,
    sanitized_html: '',
  } as never;
}

function chineseMessage(id: number) {
  return {
    id,
    account_id: 1,
    subject: `邮件 ${id}`,
    body: '这是一封中文邮件，不需要翻译。',
    sanitized_html: '',
  } as never;
}

describe('useMessageTranslation', () => {
  beforeEach(() => {
    clearTranslationCache();
    localStorage.setItem(aiServiceStorageKey, JSON.stringify({
      enabled: true,
      serviceType: 'mock',
      endpoint: '',
      apiKey: '',
      defaultModel: 'gpt-4o-mini',
      timeoutSeconds: 30,
      privacyAcknowledged: true,
    }));
  });

  it('does not offer translation for Chinese messages', () => {
    const { result } = renderHook(() => useMessageTranslation(chineseMessage(1), {}));
    expect(result.current.needsTranslation).toBe(false);
  });

  it('offers translation for foreign messages and resolves in mock mode', async () => {
    const { result } = renderHook(() => useMessageTranslation(englishMessage(1), {}));
    expect(result.current.needsTranslation).toBe(true);

    await act(async () => {
      await result.current.translate();
    });
    expect(result.current.translationState.status).toBe('success');
    expect(result.current.translationState.translation).toContain('mock 译文');
    expect(result.current.translationState.showTranslation).toBe(true);
  });

  it('resets stale translation state when switching to another message', async () => {
    const { result, rerender } = renderHook(
      ({ message }) => useMessageTranslation(message, {}),
      { initialProps: { message: englishMessage(1) } },
    );

    await act(async () => {
      await result.current.translate();
    });
    expect(result.current.translationState.status).toBe('success');

    rerender({ message: englishMessage(2) });
    expect(result.current.translationState.status).toBe('idle');
    expect(result.current.translationState.translation).toBe('');
    expect(result.current.translationState.showTranslation).toBe(false);
    expect(result.current.needsTranslation).toBe(true);
  });

  it('keeps translation state when re-rendering the same message', async () => {
    const { result, rerender } = renderHook(
      ({ message }) => useMessageTranslation(message, {}),
      { initialProps: { message: englishMessage(1) } },
    );

    await act(async () => {
      await result.current.translate();
    });
    rerender({ message: englishMessage(1) });
    expect(result.current.translationState.status).toBe('success');
  });

  it('resets when switching from a translated message to Chinese message', async () => {
    const { result, rerender } = renderHook(
      ({ message }) => useMessageTranslation(message, {}),
      { initialProps: { message: englishMessage(1) } },
    );

    await act(async () => {
      await result.current.translate();
    });
    rerender({ message: chineseMessage(2) });
    expect(result.current.needsTranslation).toBe(false);
    expect(result.current.translationState.status).toBe('idle');
  });
});


describe('translation request ownership', () => {
  beforeEach(() => clearTranslationCache());
  afterEach(() => vi.restoreAllMocks());
  function deferred() {
    let resolve!: (value: AiRequestResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<AiRequestResult>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  const translated = (content: string): AiRequestResult => ({ operation: 'translate', content, service_type: 'mock', truncated: false });
  it('ignores an old successful translation after selecting and translating another message', async () => {
    const first = deferred();
    const second = deferred();
    vi.spyOn(aiService, 'translateMessage').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const setStatus = vi.fn();
    const { result, rerender } = renderHook(({ message }) => useMessageTranslation(message, { setStatus }), {
      initialProps: { message: englishMessage(101) },
    });
    let oldRequest!: Promise<void>;
    act(() => { oldRequest = result.current.translate(); });
    rerender({ message: englishMessage(102) });
    let newRequest!: Promise<void>;
    act(() => { newRequest = result.current.translate(); });
    await act(async () => { second.resolve(translated('新邮件译文')); await newRequest; });
    await act(async () => { first.resolve(translated('旧邮件译文')); await oldRequest; });
    expect(result.current.translationState.messageId).toBe(102);
    expect(result.current.translationState.translation).toBe('新邮件译文');
    expect(setStatus).toHaveBeenCalledTimes(1);
  });
  it('ignores an old failure after selection changes', async () => {
    const pending = deferred();
    vi.spyOn(aiService, 'translateMessage').mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ message }) => useMessageTranslation(message), {
      initialProps: { message: englishMessage(201) },
    });
    let request!: Promise<void>;
    act(() => { request = result.current.translate(); });
    rerender({ message: englishMessage(202) });
    await act(async () => { pending.reject({ kind: 'external', message: 'old error' }); await request; });
    expect(result.current.translationState.status).toBe('idle');
    expect(result.current.translationState.error).toBe('');
  });
  it('invalidates cached translation when content changes without changing message id', async () => {
    const translate = vi.spyOn(aiService, 'translateMessage').mockResolvedValue(translated('第一次'));
    const { result, rerender } = renderHook(({ message }) => useMessageTranslation(message), {
      initialProps: { message: englishMessage(301) },
    });
    await act(async () => { await result.current.translate(); });
    rerender({ message: { ...englishMessage(301) as object, id: 301, account_id: 1, body: 'Updated English message with more important content to review.', sanitized_html: '' } as never });
    expect(result.current.translationState.status).toBe('idle');
    translate.mockResolvedValue(translated('更新正文译文'));
    await act(async () => { await result.current.translate(); });
    expect(translate).toHaveBeenCalledTimes(2);
    expect(result.current.translationState.translation).toBe('更新正文译文');
  });
});
