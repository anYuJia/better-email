import { useCallback, useEffect, useRef, useState } from 'react';
import App from '../App';
import {
  SETTINGS_OPEN_EVENT,
  SETTINGS_READY_EVENT,
  SETTINGS_READY_QUERY_EVENT,
  emitToMain,
  invoke,
  listenCurrentWindow,
  onCurrentWindowCloseRequested,
  type SettingsWindowRequest,
} from '../tauriBridge';
import { IPC } from '../ipc/commands';
import {
  isSettingsSectionId,
  type SettingsSectionId,
} from './settings/settingsNavigation';

function initialSettingsSection(): SettingsSectionId {
  const requested = new URLSearchParams(window.location.search).get('section');
  return isSettingsSectionId(requested) ? requested : 'accounts';
}

export default function StandaloneSettingsApp() {
  const [requestedSection, setRequestedSection] = useState<SettingsSectionId>(initialSettingsSection);
  const [nativeCloseRequestVersion, setNativeCloseRequestVersion] = useState(0);
  const readyRef = useRef(false);
  const lifecycleReadyRef = useRef(false);
  const platformReadyRef = useRef(false);
  const surfaceReadyRef = useRef(false);

  const announceReady = useCallback(() => {
    if (
      readyRef.current
      || !lifecycleReadyRef.current
      || !platformReadyRef.current
      || !surfaceReadyRef.current
    ) return;
    readyRef.current = true;
    void emitToMain(SETTINGS_READY_EVENT).catch(() => {
      readyRef.current = false;
    });
  }, []);

  const handleSurfaceReady = useCallback(() => {
    surfaceReadyRef.current = true;
    announceReady();
  }, [announceReady]);

  useEffect(() => {
    let active = true;
    const body = document.body;

    void invoke<string>(IPC.GetPlatform)
      .catch(() => 'web')
      .then((platform) => {
        if (!active) return;
        body.dataset.settingsWindowPlatform = (
          platform === 'macos' || platform === 'windows' || platform === 'linux'
            ? platform
            : 'web'
        );
        platformReadyRef.current = true;
        announceReady();
      });

    return () => {
      active = false;
      platformReadyRef.current = false;
      delete body.dataset.settingsWindowPlatform;
    };
  }, [announceReady]);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const registerWindowLifecycle = async () => {
      const closeUnlisten = await onCurrentWindowCloseRequested((event) => {
        event.preventDefault();
        setNativeCloseRequestVersion((current) => current + 1);
      });
      if (!active) {
        closeUnlisten();
        return;
      }
      unlisteners.push(closeUnlisten);

      const openUnlisten = await listenCurrentWindow<SettingsWindowRequest>(
        SETTINGS_OPEN_EVENT,
        (event) => {
          if (isSettingsSectionId(event.payload?.section)) {
            setRequestedSection(event.payload.section);
          }
        },
      );
      if (!active) {
        openUnlisten();
        return;
      }
      unlisteners.push(openUnlisten);

      const readyQueryUnlisten = await listenCurrentWindow<void>(
        SETTINGS_READY_QUERY_EVENT,
        () => {
          if (readyRef.current) {
            void emitToMain(SETTINGS_READY_EVENT).catch(() => undefined);
          } else {
            announceReady();
          }
        },
      );
      if (!active) {
        readyQueryUnlisten();
        return;
      }
      unlisteners.push(readyQueryUnlisten);

      lifecycleReadyRef.current = true;
      announceReady();
    };

    void registerWindowLifecycle();
    return () => {
      active = false;
      readyRef.current = false;
      lifecycleReadyRef.current = false;
      surfaceReadyRef.current = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [announceReady]);

  return (
    <App
      standaloneSettingsWindow
      requestedSettingsSection={requestedSection}
      nativeSettingsCloseRequestVersion={nativeCloseRequestVersion}
      onStandaloneSettingsReady={handleSurfaceReady}
    />
  );
}
