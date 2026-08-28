import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import DeferredSurface from '../components/DeferredSurface';
import { emptyDraft } from './appConfig';
import { logError } from './logger';
import { importNativeDroppedAttachmentPaths } from './nativeDroppedAttachments';
import {
  getCurrentWindow,
  isStandaloneComposerWindow,
  mockMode,
  openComposerWindow,
  invoke,
} from '../tauriBridge';
import { IPC } from '../ipc/commands';
import { reportStartupMilestone } from '../startupTelemetry';

const loadMailboxApp = () => import('../App');
const loadStandaloneComposerApp = () => import('../components/StandaloneComposerApp');
const MailboxApp = lazy(loadMailboxApp);
const StandaloneComposerApp = lazy(loadStandaloneComposerApp);
const STARTUP_POLL_INTERVAL_MS = 32;

type StartupStatus = {
  state: 'starting' | 'ready' | 'failed';
  elapsedMs: number;
  error: string | null;
};

function useBackendStartupStatus(): StartupStatus {
  const [status, setStatus] = useState<StartupStatus>(() => (
    mockMode
      ? { state: 'ready', elapsedMs: 0, error: null }
      : { state: 'starting', elapsedMs: 0, error: null }
  ));

  useEffect(() => {
    if (mockMode) return undefined;

    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const next = await invoke<StartupStatus>(IPC.GetStartupStatus);
        if (!active) return;
        setStatus(next);
        if (next.state === 'starting') {
          timer = window.setTimeout(poll, STARTUP_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (!active) return;
        setStatus({ state: 'failed', elapsedMs: 0, error: String(error) });
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return status;
}

function MainShellReadySignal({ standaloneComposer }: { standaloneComposer: boolean }) {
  const revealPromiseRef = useRef<Promise<void> | null>(null);

  useLayoutEffect(() => {
    if (standaloneComposer) return undefined;

    let active = true;
    let firstFrame = 0;
    let switchFrame = 0;
    void reportStartupMilestone('app_shell_mount');

    const scheduleVisibleFrame = () => {
      if (!active) return;
      firstFrame = window.requestAnimationFrame(() => {
        void reportStartupMilestone('app_shell_first_painted');
        if (!active || mockMode) return;
        // The first frame is now produced by the visible main WebView. Keep
        // the splash above it for one more frame so the handoff is opaque.
        switchFrame = window.requestAnimationFrame(() => {
          void invoke<void>(IPC.HideSplashscreen).catch(() => undefined);
        });
      });
    };

    if (mockMode) {
      scheduleVisibleFrame();
    } else {
      // A hidden native WebView may throttle rAF completely. Showing it while
      // the always-on-top splash remains visible lets WebKit produce a real
      // frame without exposing a blank desktop window.
      // Keep the native reveal single-flight, but attach the handoff callback
      // on every effect pass because dev StrictMode re-runs effects once.
      revealPromiseRef.current ??= invoke<void>(IPC.RevealMainWindow).catch(() => undefined);
      void revealPromiseRef.current.then(scheduleVisibleFrame, scheduleVisibleFrame);
    }

    return () => {
      active = false;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(switchFrame);
    };
  }, [standaloneComposer]);

  return null;
}

function StartupFailure({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
        boxSizing: 'border-box',
        background: 'var(--color-bg, #f7f8f7)',
        color: 'var(--color-text, #202622)',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 520 }}>
        <strong style={{ display: 'block', marginBottom: 8 }}>Better Email 启动失败</strong>
        <span style={{ opacity: 0.7, fontSize: 13 }}>{message}</span>
      </div>
    </div>
  );
}

function MainWindowFileDropBridge() {
  useEffect(() => {
    if (mockMode) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow().onDragDropEvent((event) => {
      if (!active || event.type !== 'drop') return;
      const paths = event.paths.filter((path) => path.trim());
      if (paths.length === 0) return;

      void (async () => {
        try {
          const result = await importNativeDroppedAttachmentPaths(paths);
          if (!active) return;
          if (result.failed > 0) {
            logError('Main-window native file drop partially failed', {
              failed: result.failed,
              firstError: result.firstError,
            });
          }
          if (result.attachments.length === 0) return;

          await openComposerWindow({
            draft: {
              ...emptyDraft,
              attachments: result.attachments,
            },
            replaceExisting: true,
          });
        } catch (error) {
          logError('Main-window native file drop failed', error);
        }
      })();
    })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        logError('Main-window native drag/drop listener unavailable', error);
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return null;
}

/**
 * Application entry boundary.
 *
 * The independent native splash window remains above the hidden main window
 * while the database, main HTML and application chunk warm in parallel. The
 * mailbox surface mounts only after Rust reports that MailStore is registered,
 * preventing early IPC calls from racing startup while keeping the handoff
 * aligned to a real visible frame.
 */
export default function AppRoot() {
  const startup = useBackendStartupStatus();
  const standaloneComposer = isStandaloneComposerWindow();
  const Surface = standaloneComposer ? StandaloneComposerApp : MailboxApp;

  useLayoutEffect(() => {
    void reportStartupMilestone('app_root_mount');
  }, []);

  useEffect(() => {
    const preloadSurface = standaloneComposer ? loadStandaloneComposerApp : loadMailboxApp;
    void preloadSurface().catch(() => undefined);
  }, [standaloneComposer]);

  if (startup.state === 'starting') return null;

  if (startup.state === 'failed') {
    return (
      <>
        <StartupFailure message={startup.error || '本地数据库初始化失败。'} />
        <MainShellReadySignal standaloneComposer={standaloneComposer} />
      </>
    );
  }

  return (
    <>
      {!standaloneComposer ? <MainWindowFileDropBridge /> : null}
      <Suspense
        fallback={standaloneComposer ? <DeferredSurface label="正在准备写信窗口" /> : null}
      >
        <Surface />
        <MainShellReadySignal standaloneComposer={standaloneComposer} />
      </Suspense>
    </>
  );
}
