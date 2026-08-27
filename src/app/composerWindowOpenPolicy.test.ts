import { describe, expect, it } from 'vitest';
import {
  decideComposerBootOpen,
  shouldRevealComposerWindow,
} from './composerWindowOpenPolicy';

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

describe('shouldRevealComposerWindow', () => {
  it('never exposes the native WebView before its close handler is ready', () => {
    expect(shouldRevealComposerWindow({
      booted: true,
      closeListenerReady: false,
      composerOpen: true,
      hasLoadError: false,
      openRequested: true,
    })).toBe(false);
  });

  it('reveals a fully booted composer after its close handler is installed', () => {
    expect(shouldRevealComposerWindow({
      booted: true,
      closeListenerReady: true,
      composerOpen: true,
      hasLoadError: false,
      openRequested: true,
    })).toBe(true);
  });

  it('keeps a prewarm failure hidden until the user explicitly opens composer', () => {
    expect(shouldRevealComposerWindow({
      booted: false,
      closeListenerReady: true,
      composerOpen: false,
      hasLoadError: true,
      openRequested: false,
    })).toBe(false);
    expect(shouldRevealComposerWindow({
      booted: false,
      closeListenerReady: true,
      composerOpen: false,
      hasLoadError: true,
      openRequested: true,
    })).toBe(true);
  });
});
