import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useMessageToastQueue from './useMessageToastQueue';

describe('useMessageToastQueue', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('deduplicates an active message with the same tone', () => {
    const { result } = renderHook(() => useMessageToastQueue());

    act(() => {
      result.current.showToast('AI 服务已关闭，请先在设置中开启。', 'error');
      result.current.showToast(' AI 服务已关闭，请先在设置中开启。 ', 'error');
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({
      text: 'AI 服务已关闭，请先在设置中开启。',
      tone: 'error',
    });
  });

  it('allows the same message again after its display window expires', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMessageToastQueue());

    act(() => {
      result.current.showToast('已保存设置。');
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.toasts).toHaveLength(0);

    act(() => {
      result.current.showToast('已保存设置。');
    });
    expect(result.current.toasts).toHaveLength(1);
  });
});
