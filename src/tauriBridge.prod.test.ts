import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSER_OPEN_EVENT,
  COMPOSER_READY_EVENT,
  COMPOSER_READY_QUERY_EVENT,
} from './app/composerWindow';

const mocks = vi.hoisted(() => ({
  coreInvoke: vi.fn(),
  destroy: vi.fn(),
  emit: vi.fn(),
  eventListen: vi.fn(),
  getByLabel: vi.fn(),
  getCurrentWindow: vi.fn(),
  hide: vi.fn(),
  setFocus: vi.fn(),
  show: vi.fn(),
  unlisten: vi.fn(),
  unminimize: vi.fn(),
  readyHandler: undefined as undefined | ((event: { payload: void }) => void),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.coreInvoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.eventListen,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class WebviewWindowMock {
    static getByLabel(label: string) {
      return mocks.getByLabel(label);
    }
  },
}));

import {
  prodCloseCurrentWindow,
  prodOpenComposerWindow,
  prodPrewarmComposerWindow,
} from './tauriBridge.prod';

const composerWindow = {
  emit: mocks.emit,
  show: mocks.show,
  unminimize: mocks.unminimize,
  setFocus: mocks.setFocus,
};

describe('production composer window bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readyHandler = undefined;
    mocks.coreInvoke.mockResolvedValue(undefined);
    mocks.getByLabel.mockResolvedValue(composerWindow);
    mocks.eventListen.mockImplementation(async (event, handler) => {
      if (event === COMPOSER_READY_EVENT) mocks.readyHandler = handler;
      return mocks.unlisten;
    });
    mocks.emit.mockImplementation(async (event) => {
      if (event === COMPOSER_READY_QUERY_EVENT) {
        mocks.readyHandler?.({ payload: undefined });
      }
    });
  });

  it('prewarms the renderer and reuses readiness without exposing a blank window', async () => {
    await prodPrewarmComposerWindow();
    await prodOpenComposerWindow({ restoreAutosave: true });

    expect(mocks.emit.mock.calls.map(([event]) => event)).toEqual([
      COMPOSER_READY_QUERY_EVENT,
      COMPOSER_OPEN_EVENT,
      COMPOSER_OPEN_EVENT,
    ]);
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.unminimize).not.toHaveBeenCalled();
    expect(mocks.setFocus).not.toHaveBeenCalled();
  });

  it('destroys the composer on the first close when hide is unavailable', async () => {
    mocks.hide.mockRejectedValueOnce(new Error('hide denied'));
    mocks.destroy.mockResolvedValueOnce(undefined);
    mocks.getCurrentWindow.mockReturnValue({
      label: 'composer',
      hide: mocks.hide,
      destroy: mocks.destroy,
    });

    await expect(prodCloseCurrentWindow()).resolves.toBeUndefined();
    expect(mocks.hide).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
