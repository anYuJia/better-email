import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useCompositionGuard from './useCompositionGuard';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('reserves candidate keys during and immediately after IME composition', () => {
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { result } = renderHook(useCompositionGuard);
  expect(result.current.isComposing()).toBe(false);
  act(() => result.current.onCompositionStart());
  expect(result.current.isComposing()).toBe(true);
  act(() => result.current.onCompositionEnd());
  expect(result.current.isComposing()).toBe(true);
  now += 81;
  expect(result.current.isComposing()).toBe(false);
  expect(result.current.isComposing({ nativeEvent: { isComposing: true } })).toBe(true);
  expect(result.current.isComposing({ nativeEvent: { keyCode: 229 } })).toBe(true);
  expect(result.current.isComposing({ nativeEvent: { keyCode: 13 } })).toBe(false);
});
