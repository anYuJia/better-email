import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ListMode } from '../app/types';
import { mobileSelectionHistoryKey, withoutMobileSelection } from './mobileSelectionHistory';

let nextSelectionOwner = 0;
type Options = {
  isMobileApp: boolean;
  mobileScreen: string;
  mobileSearchOpen: boolean;
  listMode: ListMode;
  mailboxUnavailable: boolean;
  mailboxListStateKey: string;
  selectedMessageIds: readonly number[];
  messageCount: number;
  clearSelection: () => void;
};

function hasSelectionPopup() {
  return Boolean(document.querySelector(
    'details[data-menu-managed][open], .context-menu:not([aria-hidden="true"]), ' +
    '.message-date-picker-popover, .message-date-range-modal, ' +
    '.custom-select-dropdown.is-open[aria-hidden="false"], .custom-select-summary[aria-expanded="true"]',
  ));
}

/** Own the temporary touch-selection layer, including an empty selection. */
export default function useMobileInboxSelection(options: Options) {
  const { isMobileApp, mobileScreen, mobileSearchOpen, listMode, mailboxUnavailable, mailboxListStateKey, selectedMessageIds, messageCount, clearSelection } = options;
  const [selectionKey, setSelectionKey] = useState<string | null>(null);
  const ownerRef = useRef<string | null>(null);
  if (ownerRef.current === null) ownerRef.current = `selection-${++nextSelectionOwner}`;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const ownsHistoryRef = useRef(false);
  const exitingRef = useRef(false);
  const reenterRef = useRef(false);
  const contextRef = useRef(mailboxListStateKey);
  const eligible = isMobileApp && mobileScreen === 'mail' && listMode === 'messages' && !mailboxUnavailable;
  const selectionMode = eligible && (selectionKey === mailboxListStateKey || selectedMessageIds.length > 0);
  const activeRef = useRef(selectionMode);
  activeRef.current = selectionMode;

  const ensureHistory = useCallback(() => {
    if (window.history.state?.[mobileSelectionHistoryKey] === ownerRef.current) { ownsHistoryRef.current = true; return; }
    window.history.pushState({ ...withoutMobileSelection(window.history.state), [mobileSelectionHistoryKey]: ownerRef.current }, '');
    ownsHistoryRef.current = true;
  }, []);

  const enterMobileSelection = useCallback(() => {
    const current = optionsRef.current;
    if (!current.isMobileApp || current.mobileScreen !== 'mail' || current.listMode !== 'messages' || current.mailboxUnavailable) return;
    setSelectionKey(current.mailboxListStateKey);
    activeRef.current = true;
    if (exitingRef.current) { reenterRef.current = true; return; }
    ensureHistory();
  }, [ensureHistory]);

  const exitMobileSelection = useCallback(() => {
    reenterRef.current = false;
    setSelectionKey(null);
    activeRef.current = false;
    optionsRef.current.clearSelection();
    if (!exitingRef.current && window.history.state?.[mobileSelectionHistoryKey] === ownerRef.current) {
      exitingRef.current = true;
      window.history.back();
    } else if (!exitingRef.current) ownsHistoryRef.current = false;
  }, []);

  useLayoutEffect(() => {
    const contextChanged = contextRef.current !== mailboxListStateKey;
    contextRef.current = mailboxListStateKey;
    const destinationReplacedSelection = ownsHistoryRef.current && !exitingRef.current
      && window.history.state?.[mobileSelectionHistoryKey] !== ownerRef.current;
    if (contextChanged || !eligible || destinationReplacedSelection) {
      if (ownsHistoryRef.current || selectionKey !== null) exitMobileSelection();
      return;
    }
    // Space/select-all can enter selection without using the touch menu.
    if (selectionMode && !ownsHistoryRef.current && !exitingRef.current) ensureHistory();
  }, [eligible, mailboxListStateKey, mobileSearchOpen, selectionKey, selectionMode, ensureHistory, exitMobileSelection]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // A responsive handoff can finish its pending Back on desktop. Still
      // release our ownership so the next mobile entry can start normally.
      if (!optionsRef.current.isMobileApp && !ownsHistoryRef.current) return;
      const incomingOwner = event.state?.[mobileSelectionHistoryKey];
      if (incomingOwner && !(incomingOwner === ownerRef.current && activeRef.current)) {
        // A finished selection cannot be resurrected by Forward or become an
        // empty extra Back step after another destination replaced it.
        event.stopImmediatePropagation();
        window.history.back();
        return;
      }
      if (!ownsHistoryRef.current) return;
      if (incomingOwner === ownerRef.current) return;
      if (activeRef.current && !exitingRef.current && hasSelectionPopup()) {
        event.stopImmediatePropagation();
        const target = document.activeElement ?? document.body;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        window.history.pushState({ ...withoutMobileSelection(event.state), [mobileSelectionHistoryKey]: ownerRef.current }, '');
        return;
      }
      const wasExiting = exitingRef.current;
      ownsHistoryRef.current = false;
      exitingRef.current = false;
      if (reenterRef.current) {
        reenterRef.current = false;
        event.stopImmediatePropagation();
        ensureHistory();
        return;
      }
      activeRef.current = false;
      setSelectionKey(null);
      if (!wasExiting) optionsRef.current.clearSelection();
    };
    // Run before the navigation hook applies the underlying screen: a popup's
    // first Back only closes that popup and restores the selection entry.
    window.addEventListener('popstate', handlePopState, true);
    return () => window.removeEventListener('popstate', handlePopState, true);
  }, [ensureHistory]);

  return {
    mobileSelectionMode: selectionMode,
    headerSelectionProps: { selectionMode, selectedCount: selectedMessageIds.length, canSelect: messageCount > 0, onEnterSelection: enterMobileSelection, onExitSelection: exitMobileSelection },
    listSelectionProps: { selectionMode, onEnterSelection: isMobileApp ? enterMobileSelection : undefined },
    selectionShortcutsProps: { selectionMode, clearSelection: selectionMode ? exitMobileSelection : clearSelection },
  };
}
