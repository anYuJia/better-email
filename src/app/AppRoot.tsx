import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import DeferredSurface from '../components/DeferredSurface';
import { emptyDraft } from './appConfig';
import { logError } from './logger';
import { importNativeDroppedAttachmentPaths } from './nativeDroppedAttachments';
import {
  getCurrentWindow,
  isStandaloneComposerWindow,
  isStandaloneSettingsWindow,
  mockMode,
  openComposerWindow,
  invoke,
} from '../tauriBridge';
import { IPC } from '../ipc/commands';
import { reportStartupMilestone } from '../startupTelemetry';

const loadMailboxApp = () => import('../App');
const loadStandaloneComposerApp = () => import('../components/StandaloneComposerApp');
const loadStandaloneSettingsApp = () => import('../components/StandaloneSettingsApp');
const MailboxApp = lazy(loadMailboxApp);
const StandaloneComposerApp = lazy(loadStandaloneComposerApp);
const StandaloneSettingsApp = lazy(loadStandaloneSettingsApp);
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
        if (next.state === 'starting') timer = window.setTimeout(poll, STARTUP_POLL_INTERVAL_MS);
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

function MainShellReadySignal({ standaloneWindow }: { standaloneWindow: boolean }) {
  const revealPromiseRef = useRef<Promise<void> | null>(null);

  useLayoutEffect(() => {
    if (standaloneWindow) return undefined;
    let active = true;
    let firstFrame = 0;
    let switchFrame = 0;
    void reportStartupMilestone('app_shell_mount');
    const scheduleVisibleFrame = () => {
      if (!active) return;
      firstFrame = window.requestAnimationFrame(() => {
        void reportStartupMilestone('app_shell_first_painted');
        if (!active || mockMode) return;
        switchFrame = window.requestAnimationFrame(() => {
          void invoke<void>(IPC.HideSplashscreen).catch(() => undefined);
        });
      });
    };
    if (mockMode) scheduleVisibleFrame();
    else {
      revealPromiseRef.current ??= invoke<void>(IPC.RevealMainWindow).catch(() => undefined);
      void revealPromiseRef.current.then(scheduleVisibleFrame, scheduleVisibleFrame);
    }
    return () => {
      active = false;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(switchFrame);
    };
  }, [standaloneWindow]);

  return null;
}

function StartupFailure({ message }: { message: string }) {
  return (
    <div role="alert" style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 32, boxSizing: 'border-box', background: 'var(--color-bg, #f7f8f7)', color: 'var(--color-text, #202622)', textAlign: 'center' }}>
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
          if (result.failed > 0) logError('Main-window native file drop partially failed', { failed: result.failed, firstError: result.firstError });
          if (result.attachments.length === 0) return;
          await openComposerWindow({ draft: { ...emptyDraft, attachments: result.attachments }, replaceExisting: true });
        } catch (error) {
          logError('Main-window native file drop failed', error);
        }
      })();
    }).then((nextUnlisten) => { unlisten = nextUnlisten; })
      .catch((error) => logError('Main-window native drag/drop listener unavailable', error));
    return () => { active = false; unlisten?.(); };
  }, []);
  return null;
}

export default function AppRoot() {
  const startup = useBackendStartupStatus();
  const standaloneComposer = isStandaloneComposerWindow();
  const standaloneSettings = isStandaloneSettingsWindow();
  const standaloneWindow = standaloneComposer || standaloneSettings;

  useLayoutEffect(() => { void reportStartupMilestone('app_root_mount'); }, []);

  useEffect(() => {
    const preloadSurface = standaloneComposer ? loadStandaloneComposerApp : standaloneSettings ? loadStandaloneSettingsApp : loadMailboxApp;
    void preloadSurface().catch(() => undefined);
  }, [standaloneComposer, standaloneSettings]);

  if (startup.state === 'starting') return null;
  if (startup.state === 'failed') {
    return <><StartupFailure message={startup.error || '本地数据库初始化失败。'} /><MainShellReadySignal standaloneWindow={standaloneWindow} /></>;
  }

  const standaloneSurface = standaloneComposer
    ? <StandaloneComposerApp />
    : standaloneSettings
      ? <StandaloneSettingsApp />
      : null;

  return (
    <>
      {!standaloneWindow ? <MainWindowFileDropBridge /> : null}
      <Suspense fallback={standaloneComposer ? <DeferredSurface label="正在准备写信窗口" /> : standaloneSettings ? <DeferredSurface label="正在准备设置窗口" /> : null}>
        {standaloneSurface ?? <MailboxApp />}
        <MainShellReadySignal standaloneWindow={standaloneWindow} />
      </Suspense>
    </>
  );
}
