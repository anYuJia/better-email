import { describe, expect, it } from 'vitest';
import { decideComposerBootOpen } from './composerWindowOpenPolicy';

describe('decideComposerBootOpen', () => {
  it('keeps a pure prewarm hidden when no open request exists', () => {
    expect(decideComposerBootOpen(false, true, false)).toEqual({
      shouldOpen: false,
      restoreWhenMissing: true,
    });
  });

  it('opens a prewarmed window when the user clicked before boot completed', () => {
    expect(decideComposerBootOpen(false, true, true)).toEqual({
      shouldOpen: true,
      restoreWhenMissing: true,
    });
  });

  it('always opens when a pending compose request exists', () => {
    expect(decideComposerBootOpen(true, true, false)).toEqual({
      shouldOpen: true,
      restoreWhenMissing: false,
    });
  });

  it('opens a non-prewarmed standalone composer normally', () => {
    expect(decideComposerBootOpen(false, false, false)).toEqual({
      shouldOpen: true,
      restoreWhenMissing: true,
    });
  });
});
