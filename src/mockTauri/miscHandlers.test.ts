import { describe, expect, it } from 'vitest';
import { resolveMockBoundSecretKey } from './miscHandlers';

describe('mock AI settings secret binding', () => {
  it('keeps a key when its endpoint binding is unchanged', () => {
    expect(resolveMockBoundSecretKey('', false, 'saved', false)).toBe('saved');
    expect(resolveMockBoundSecretKey('', true, 'saved', false)).toBe('');
    expect(resolveMockBoundSecretKey(' new ', false, 'saved', false)).toBe('new');
  });

  it('rejects silently reusing a key after an endpoint change', () => {
    expect(() => resolveMockBoundSecretKey('', false, 'saved', true))
      .toThrow(/重新输入 API Key/);
    expect(resolveMockBoundSecretKey('new', false, 'saved', true)).toBe('new');
  });
});
