import { describe, expect, it } from 'vitest';
import { resolveMockBoundSecretKey } from './miscHandlers';

describe('mock AI settings secret binding', () => {
  it('keeps a key only when its service binding is unchanged', () => {
    expect(resolveMockBoundSecretKey('', false, 'saved', false, false)).toBe('saved');
    expect(resolveMockBoundSecretKey('', true, 'saved', false, false)).toBe('');
    expect(resolveMockBoundSecretKey(' new ', false, 'saved', false, false)).toBe('new');
  });

  it('rejects silently reusing a key after an endpoint change', () => {
    expect(() => resolveMockBoundSecretKey('', false, 'saved', false, true))
      .toThrow(/重新输入 API Key/);
    expect(resolveMockBoundSecretKey('new', false, 'saved', false, true)).toBe('new');
  });

  it('clears old keys when switching service types', () => {
    expect(resolveMockBoundSecretKey('', false, 'saved', true, false)).toBe('');
    expect(resolveMockBoundSecretKey('new', false, 'saved', true, false)).toBe('new');
  });
});
