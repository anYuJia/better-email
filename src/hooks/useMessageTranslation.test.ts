import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useMessageTranslation from './useMessageTranslation';
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
