import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useUnreadFocusSync from './useUnreadFocusSync';

// vi.mock 会被提升到文件顶部执行，因此需要在 hoisted 作用域里创建共享的 mock，
// 让 mock factory 与测试主体都能访问同一个 onFocusChanged / unlisten / handler 槽位。
const { focusHandlerRef, unlisten, onFocusChanged } = vi.hoisted(() => {
  const focusHandlerRef: { current: ((focused: boolean) => void) | null } = { current: null };
  const unlisten = vi.fn(async () => undefined);
  const onFocusChanged = vi.fn(async (handler: (focused: boolean) => void) => {
    focusHandlerRef.current = handler;
    return unlisten;
  });
  return { focusHandlerRef, unlisten, onFocusChanged };
});

vi.mock('../tauriBridge', () => ({
  getCurrentWindow: () => ({ onFocusChanged }),
}));

/** 冲刷 act 外的异步 cleanup（onFocusChanged 的 Promise 在微任务里才 resolve）。 */
function flushAsync() {
  return act(async () => {
    // 空操作：让挂起的微任务先落定。
  });
}

function renderFocus(refresh: ReturnType<typeof vi.fn>, initialScope: number | 'all') {
  return renderHook(
    ({ scope }: { scope: number | 'all' }) => useUnreadFocusSync(refresh, scope),
    { initialProps: { scope: initialScope } },
  );
}

function fireFocus(focused: boolean) {
  act(() => {
    focusHandlerRef.current?.(focused);
  });
}

describe('useUnreadFocusSync 焦点订阅', () => {
  beforeEach(async () => {
    await flushAsync();
    focusHandlerRef.current = null;
    onFocusChanged.mockClear();
    unlisten.mockClear();
  });

  it('初次挂载订阅一次，并立即刷新一次当前 scope 的统计', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderFocus(refresh, 1);

    expect(onFocusChanged).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(1);
  });

  it('无关状态更新不会重新订阅，也不会触发额外 GetStats', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderFocus(refresh, 1);
    expect(onFocusChanged).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    // 相同 scope、相同 refresh 引用：模拟任意状态文案/无关状态更新触发的重渲染。
    rerender({ scope: 1 });
    await flushAsync();
    expect(onFocusChanged).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(unlisten).not.toHaveBeenCalled();
  });

  it('窗口真正获得焦点时只触发一次 GetStats', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderFocus(refresh, 1);
    expect(refresh).toHaveBeenCalledTimes(1);

    fireFocus(true);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith(1);

    fireFocus(true);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('窗口失焦时不触发任何刷新', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderFocus(refresh, 1);
    expect(refresh).toHaveBeenCalledTimes(1);

    fireFocus(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onFocusChanged).toHaveBeenCalledTimes(1);
  });

  it('账号 scope 切换后重新订阅并使用新 scope 的统计', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderFocus(refresh, 1);
    expect(onFocusChanged).toHaveBeenCalledTimes(1);

    rerender({ scope: 'all' });
    await flushAsync();
    expect(onFocusChanged).toHaveBeenCalledTimes(2);
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith('all');
  });

  it('卸载时正确取消订阅', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderFocus(refresh, 1);

    unmount();
    await flushAsync();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
