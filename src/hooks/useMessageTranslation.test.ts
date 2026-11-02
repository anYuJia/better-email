import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useMessageTranslation, {
  cacheTranslation,
  clearTranslationCache,
  getCachedTranslation,
} from './useMessageTranslation';
import * as aiService from '../app/aiService';
import * as aiConfig from '../app/aiServiceConfig';
import type { AiRequestResult } from '../app/types/ai';
import { aiServiceStorageKey } from '../app/aiServiceConfig';
import { IPC } from '../ipc/commands';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('../tauriBridge', () => ({
  invoke: invokeMock,
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

function htmlEnglishMessage(id: number) {
  return {
    id,
    account_id: 1,
    subject: `HTML Message ${id}`,
    body: '<p>Hello TRAE</p>',
    sanitized_html: '<p>Hello TRAE</p><a href="https://example.com/docs">OpenAI</a>',
  } as never;
}

describe('useMessageTranslation', () => {
  beforeEach(() => {
    clearTranslationCache();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string, args?: { input?: { operation?: string; text?: string } }) => {
      if (command === IPC.LoadAiSettings) {
        return {
          configured: true,
          enabled: true,
          service_type: 'http',
          endpoint: 'https://api.example.com/v1',
          has_api_key: true,
          model: 'gpt-4o-mini',
          timeout_seconds: 30,
          privacy_acknowledged: true,
          mcp_enabled: false,
          mcp_endpoint: '',
          has_mcp_api_key: false,
        };
      }
      if (command === IPC.AiRequest) {
        const source = String(args?.input?.text ?? '');
        return {
          operation: args?.input?.operation ?? 'translate',
          content: source.includes('__BETTER_EMAIL_') ? source : '你好，已收到。',
          service_type: 'http',
          truncated: false,
        };
      }
      throw new Error(`Unexpected IPC command: ${command}`);
    });
    localStorage.setItem(aiServiceStorageKey, JSON.stringify({
      enabled: true,
      serviceType: 'http',
      endpoint: 'https://api.example.com/v1',
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

  it('offers translation for foreign messages and resolves through the configured HTTP service', async () => {
    const { result } = renderHook(() => useMessageTranslation(englishMessage(1), {}));
    expect(result.current.needsTranslation).toBe(true);

    await act(async () => {
      await result.current.translate();
    });
    expect(result.current.translationState.status).toBe('success');
    expect(result.current.translationState.translation).toContain('你好');
    expect(result.current.translationState.format).toBe('plain');
    expect(result.current.translationState.showTranslation).toBe(true);
  });

  it('returns an HTML translation that keeps the original link target', async () => {
    const { result } = renderHook(() => useMessageTranslation(htmlEnglishMessage(3), {}));

    await act(async () => {
      await result.current.translate();
    });

    expect(result.current.translationState.status).toBe('success');
    expect(result.current.translationState.format).toBe('html');
    expect(result.current.translationState.translation).toContain('<a href="https://example.com/docs">');
    expect(result.current.translationState.translation).toContain('OpenAI');
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

  it('does not reuse a cached translation after the configured model changes', async () => {
    let model = 'model-a';
    let requestCount = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === IPC.LoadAiSettings) {
        return {
          configured: true,
          enabled: true,
          service_type: 'http',
          endpoint: 'https://api.example.com/v1',
          has_api_key: true,
          model,
          timeout_seconds: 30,
          privacy_acknowledged: true,
          mcp_enabled: false,
          mcp_endpoint: '',
          has_mcp_api_key: false,
        };
      }
      if (command === IPC.AiRequest) {
        requestCount += 1;
        return {
          operation: 'translate',
          content: model === 'model-a' ? '模型 A 译文' : '模型 B 译文',
          service_type: 'http',
          truncated: false,
        };
      }
      throw new Error(`Unexpected IPC command: ${command}`);
    });
    const { result } = renderHook(() => useMessageTranslation(englishMessage(9), {}));

    await act(async () => {
      await result.current.translate();
    });
    expect(result.current.translationState.translation).toBe('模型 A 译文');

    model = 'model-b';
    await act(async () => {
      await result.current.translate();
    });
    expect(result.current.translationState.translation).toBe('模型 B 译文');
    expect(requestCount).toBe(2);
  });

  it('keeps the in-memory translation cache bounded with LRU eviction', () => {
    for (let index = 0; index < 70; index += 1) {
      cacheTranslation(`key-${index}`, `value-${index}`);
    }
    expect(getCachedTranslation('key-0')).toBeUndefined();
    expect(getCachedTranslation('key-69')).toBe('value-69');
  });
});


describe('translation request ownership', () => {
  beforeEach(() => {
    clearTranslationCache();
    vi.spyOn(aiConfig, 'loadEffectiveAiServiceConfig').mockResolvedValue({
      ...aiConfig.defaultAiServiceConfig, enabled: true, privacyAcknowledged: true,
      endpoint: 'https://api.example.com/v1',
    });
  });
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
    await act(async () => { oldRequest = result.current.translate(); });
    rerender({ message: englishMessage(102) });
    let newRequest!: Promise<void>;
    await act(async () => { newRequest = result.current.translate(); });
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
    await act(async () => { request = result.current.translate(); });
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

  it('deduplicates rapid requests before provider configuration has resolved', async () => {
    const response = deferred();
    const translate = vi.spyOn(aiService, 'translateMessage').mockReturnValue(response.promise);
    const { result } = renderHook(() => useMessageTranslation(englishMessage(401)));
    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    await act(async () => {
      first = result.current.translate();
      duplicate = result.current.translate();
    });
    expect(aiConfig.loadEffectiveAiServiceConfig).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledTimes(1);
    await act(async () => { response.resolve(translated('唯一译文')); await Promise.all([first, duplicate]); });
    expect(result.current.translationState.translation).toBe('唯一译文');
  });

  it('sanitizes AI markup and invalidates cached HTML when the rendered resource policy changes', async () => {
    const translate = vi.spyOn(aiService, 'translateMessage').mockImplementation(async (text) => (
      translated(text + '<img src="https://attacker.invalid/track.png">')
    ));
    const allowed = '<p>Hello from English sender, please review the attached quote.</p><img src="https://original.invalid/logo.png">';
    const blocked = '<p>Hello from English sender, please review the attached quote.</p><img data-blocked-src="https://original.invalid/logo.png">';
    const { result, rerender } = renderHook(({ html }) => useMessageTranslation(englishMessage(501), { sourceHtml: html }), {
      initialProps: { html: allowed },
    });
    await act(async () => { await result.current.translate(); });
    expect(result.current.translationState.format).toBe('html');
    expect(result.current.translationState.translation).toContain('src="https://original.invalid/logo.png"');
    expect(result.current.translationState.translation).not.toContain('attacker.invalid');
    rerender({ html: blocked });
    await act(async () => { await result.current.translate(); });
    expect(translate).toHaveBeenCalledTimes(2);
    expect(result.current.translationState.translation).toContain('data-blocked-src=');
    expect(result.current.translationState.translation).not.toMatch(/<img src=/);
  });
});
