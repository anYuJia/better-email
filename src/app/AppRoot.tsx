import { lazy, Suspense, useEffect, useState } from 'react';
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

function BootReadySignal({ backendElapsedMs }: { backendElapsedMs: number }) {
  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    let removalTimer: number | undefined;

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        document.documentElement.dataset.appReady = 'true';
        try {
          performance.mark('better-email:app-shell-ready');
          performance.measure(
            'better-email:html-to-app-shell',
            'better-email:html-bootstrap',
            'better-email:app-shell-ready',
          );
          if (import.meta.env.DEV) {
            const measures = performance.getEntriesByName('better-email:html-to-app-shell');
            const measure = measures[measures.length - 1];
            console.info('[better-email][startup]', {
              backendMs: backendElapsedMs,
              htmlToShellMs: Math.round(measure?.duration ?? 0),
            });
          }
        } catch {
          // Startup timing is diagnostic-only and must never block the UI.
        }
        removalTimer = window.setTimeout(() => {
          document.getElementById('boot-splash')?.remove();
        }, 220);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (removalTimer !== undefined) window.clearTimeout(removalTimer);
    };
  }, [backendElapsedMs]);

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
 * The static HTML splash is painted before React. Native database bootstrap and
 * the large application chunk are warmed in parallel; the mailbox surface only
 * mounts after Rust reports that MailStore has been registered, preventing
 * early IPC calls from racing startup while keeping the first frame immediate.
 */
export default function AppRoot() {
  const startup = useBackendStartupStatus();
  const standaloneComposer = isStandaloneComposerWindow();
  const Surface = standaloneComposer ? StandaloneComposerApp : MailboxApp;

  useEffect(() => {
    const preloadSurface = standaloneComposer ? loadStandaloneComposerApp : loadMailboxApp;
    void preloadSurface().catch(() => undefined);
  }, [standaloneComposer]);

  if (startup.state === 'starting') return null;

  if (startup.state === 'failed') {
    return (
      <>
        <StartupFailure message={startup.error || '本地数据库初始化失败。'} />
        <BootReadySignal backendElapsedMs={startup.elapsedMs} />
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
        <BootReadySignal backendElapsedMs={startup.elapsedMs} />
      </Suspense>
    </>
  );
}
