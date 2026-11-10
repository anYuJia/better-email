import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AccountScope } from '../app/types';
import type { SettingsSectionId } from '../components/settings/SettingsFrame';
import { closeCurrentWindow, emitToMain, SETTINGS_CLOSED_EVENT } from '../tauriBridge';
import type useAppMetaLoader from './useAppMetaLoader';

type Options = {
  standalone: boolean;
  isOpen: boolean;
  requestedSection: SettingsSectionId;
  folderId: number | null;
  accountScope: AccountScope;
  loadMeta: ReturnType<typeof useAppMetaLoader>['loadMeta'];
  setSection: Dispatch<SetStateAction<SettingsSectionId>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

/** Owns the native Settings window's bootstrap and close lifecycle. */
export default function useStandaloneSettingsLifecycle({
  standalone, isOpen, requestedSection, folderId, accountScope, loadMeta, setSection, setStatus,
}: Options) {
  const bootstrapped = useRef(false);
  const closeStarted = useRef(false);

  useEffect(() => {
    if (standalone) setSection(requestedSection);
  }, [requestedSection, setSection, standalone]);

  useEffect(() => {
    if (!standalone || bootstrapped.current) return;
    bootstrapped.current = true;
    loadMeta(folderId, accountScope, { mode: 'full' }).catch((error) => setStatus(String(error)));
  }, [accountScope, folderId, loadMeta, setStatus, standalone]);

  useEffect(() => {
    if (!standalone || isOpen || closeStarted.current) return;
    closeStarted.current = true;
    void emitToMain(SETTINGS_CLOSED_EVENT)
      .catch(() => undefined)
      .then(() => closeCurrentWindow())
      .catch((error) => {
        closeStarted.current = false;
        setStatus(`无法关闭设置窗口：${String(error)}`);
      });
  }, [isOpen, setStatus, standalone]);
}
