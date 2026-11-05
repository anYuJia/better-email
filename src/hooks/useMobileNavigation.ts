import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { SettingsSectionId } from '../components/settings/settingsNavigation';
import { mobileSelectionHistoryKey, withoutMobileSelection } from './mobileSelectionHistory';

type Options = {
  isMobileApp: boolean;
  isSettingsOpen: boolean;
  activeSettingsSection: SettingsSectionId;
  setActiveSettingsSection: Dispatch<SetStateAction<SettingsSectionId>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
};

/** One browser/native history contract for all mobile destinations. */
export default function useMobileNavigation({ isMobileApp, isSettingsOpen, activeSettingsSection, setActiveSettingsSection, setSettingsOpen }: Options) {
  const [mobileScreen, setMobileScreen] = useState<'mail' | 'reader' | 'mailbox' | 'settings'>('mail');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const initializedHistoryRef = useRef(false);
  const settingsRef = useRef({ isSettingsOpen, activeSettingsSection });
  settingsRef.current = { isSettingsOpen, activeSettingsSection };
  const desktopSnapshotRef = useRef<{ destination: string; settingsOpen: boolean } | null>(null);
  useEffect(() => {
    const destination = () => JSON.stringify([
      window.history.state?.betterEmailScreen ?? 'mail',
      window.history.state?.betterEmailSettingsSection ?? null,
      Boolean(window.history.state?.betterEmailSearch),
    ]);
    if (!isMobileApp) {
      desktopSnapshotRef.current = { destination: destination(), settingsOpen: settingsRef.current.isSettingsOpen };
      return undefined;
    }
    const applyHistoryState = (state: typeof window.history.state) => {
      const next = state?.betterEmailScreen;
      const nextScreen = next === 'reader' || next === 'mailbox' || next === 'settings'
        ? next
        : 'mail';
      setMobileScreen(nextScreen);
      setMobileSearchOpen(Boolean(state?.betterEmailSearch));
      if (nextScreen === 'settings' && typeof state?.betterEmailSettingsSection === 'string') {
        setActiveSettingsSection(state.betterEmailSettingsSection as SettingsSectionId);
        setSettingsOpen(true);
      } else {
        setSettingsOpen(false);
      }
    };
    const desktopSnapshot = desktopSnapshotRef.current;
    desktopSnapshotRef.current = null;
    const historyChangedOnDesktop = desktopSnapshot && desktopSnapshot.destination !== destination();
    const firstMobileEntry = !initializedHistoryRef.current;
    initializedHistoryRef.current = true;
    const {
      betterEmailSettingsSection: _settingsSection,
      betterEmailSettingsDirection: _settingsDirection,
      betterEmailSearch: _search,
      betterEmailInboxSelection: _selection,
      ...baseState
    } = window.history.state ?? {};
    if (!firstMobileEntry && historyChangedOnDesktop) {
      // Browser Back/Forward while on desktop takes precedence over a
      // settings overlay whose React state has not seen that history event.
      applyHistoryState(window.history.state);
    } else if (settingsRef.current.isSettingsOpen) {
      // A live desktop Settings page survives the responsive handoff. Give
      // it the same root/detail Back path as opening it directly on mobile.
      if (firstMobileEntry) {
        window.history.replaceState({ ...baseState, betterEmailScreen: 'mail' }, '');
      }
      if (window.history.state?.betterEmailScreen !== 'settings') {
        window.history.pushState({ ...baseState, betterEmailScreen: 'settings' }, '');
      }
      const detailState = {
        ...baseState,
        betterEmailScreen: 'settings',
        betterEmailSettingsSection: settingsRef.current.activeSettingsSection,
        betterEmailSettingsDirection: 'none',
      };
      if (window.history.state?.betterEmailSettingsSection) window.history.replaceState(detailState, '');
      else window.history.pushState(detailState, '');
      setMobileScreen('settings');
      setMobileSearchOpen(false);
    } else if (firstMobileEntry || desktopSnapshot?.settingsOpen) {
      // A reload does not retain the selected message or search query. Start
      // from the mailbox. A Settings page closed on desktop stays closed too.
      window.history.replaceState({ ...baseState, betterEmailScreen: 'mail' }, '');
      setMobileScreen('mail');
      setMobileSearchOpen(false);
    } else {
      // History can move while the desktop surface owns the window. Restore
      // its current destination, rather than the last mobile React state.
      applyHistoryState(window.history.state);
    }
    const handlePopState = (event: PopStateEvent) => applyHistoryState(event.state);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isMobileApp, setActiveSettingsSection, setSettingsOpen]);

  const navigateMobileScreen = useCallback((nextScreen: 'mail' | 'reader' | 'mailbox' | 'settings') => {
    setMobileScreen(nextScreen);
    setMobileSearchOpen(false);
    if (!isMobileApp) return;
    const currentState = window.history.state ?? {};
    const {
      betterEmailSettingsSection: _settingsSection,
      betterEmailSettingsDirection: _settingsDirection,
      betterEmailSearch: _search,
      ...baseState
    } = withoutMobileSelection(currentState);
    if (currentState.betterEmailScreen === nextScreen) {
      if (currentState[mobileSelectionHistoryKey] && !currentState.betterEmailSearch) {
        window.history.back();
        return;
      }
      if (currentState.betterEmailSearch) {
        window.history.replaceState({ ...baseState, betterEmailScreen: nextScreen }, '');
      }
      return;
    }
    const nextState = { ...baseState, betterEmailScreen: nextScreen };
    if (currentState[mobileSelectionHistoryKey]) window.history.replaceState(nextState, '');
    else window.history.pushState(nextState, '');
  }, [isMobileApp]);

  const backMobileScreen = useCallback(() => {
    setMobileSearchOpen(false);
    if (isMobileApp && window.history.state?.[mobileSelectionHistoryKey]) {
      window.history.back();
      return;
    }
    if (isMobileApp && window.history.state?.betterEmailSearch) {
      window.history.back();
      return;
    }
    if (isMobileApp && window.history.state?.betterEmailScreen !== 'mail') {
      window.history.back();
      return;
    }
    setMobileScreen('mail');
  }, [isMobileApp]);

  const openMobileSearch = useCallback(() => {
    setMobileSearchOpen(true);
    if (!isMobileApp) return;
    if (window.history.state?.betterEmailSearch) {
      if (window.history.state?.[mobileSelectionHistoryKey]) window.history.back();
      return;
    }
    const state = window.history.state;
    const nextState = { ...withoutMobileSelection(state), betterEmailSearch: true };
    if (state?.[mobileSelectionHistoryKey]) window.history.replaceState(nextState, '');
    else window.history.pushState(nextState, '');
  }, [isMobileApp]);

  const closeMobileSearch = useCallback(() => {
    if (isMobileApp && window.history.state?.betterEmailSearch) {
      window.history.back();
      return;
    }
    setMobileSearchOpen(false);
  }, [isMobileApp]);

  return { mobileScreen, setMobileScreen, mobileSearchOpen, navigateMobileScreen, backMobileScreen, openMobileSearch, closeMobileSearch };
}
