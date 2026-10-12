import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAiSettingsFromBackend, normalizeAiTimeoutSeconds, secretDraftLabel } from './aiServiceConfig';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('../tauriBridge', () => ({ invoke: invokeMock }));
afterEach(() => invokeMock.mockReset());

describe('AI settings boundaries', () => {
  it('retains read errors in strict settings mode while keeping the runtime fallback', async () => {
    invokeMock.mockRejectedValue(new Error('数据库不可用'));
    await expect(loadAiSettingsFromBackend({ strict: true })).rejects.toThrow('数据库不可用');
    await expect(loadAiSettingsFromBackend()).resolves.toBeNull();
  });

  it.each([[1, 5], [999, 300], [30.7, 30], [NaN, 30], [Infinity, 30]])('normalizes timeout %s to %s', (value, expected) => {
    expect(normalizeAiTimeoutSeconds(value)).toBe(expected);
  });

  it('distinguishes saved credentials from pending replacement and removal', () => {
    expect(secretDraftLabel(true, '', false)).toBe('已保存');
    expect(secretDraftLabel(true, 'new-token', false)).toBe('待保存');
    expect(secretDraftLabel(false, '', true)).toBe('待清除');
    expect(secretDraftLabel(false, '', false)).toBe('未配置');
  });
});
