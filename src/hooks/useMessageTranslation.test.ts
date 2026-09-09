import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useMessageTranslation, {
  cacheTranslation,
  clearTranslationCache,
  getCachedTranslation,
} from './useMessageTranslation';
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
