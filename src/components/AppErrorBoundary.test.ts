import { describe, expect, it } from 'vitest';
import { errorSummary } from './AppErrorBoundary';

describe('AppErrorBoundary helpers', () => {
  it('uses useful error messages for crash fallback copy', () => {
    expect(errorSummary(new Error('Reader render failed'))).toBe('Reader render failed');
    expect(errorSummary('lazy chunk missing')).toBe('lazy chunk missing');
  });

  it('falls back safely for empty or unknown errors', () => {
    expect(errorSummary(new Error('   '))).toBe('未知渲染错误');
    expect(errorSummary(null)).toBe('未知渲染错误');
  });
});
