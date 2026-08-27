import { useEffect } from 'react';
import type { RefObject } from 'react';

type UseAppShortcutsOptions = {
  enabled?: boolean;
  searchInputRef: RefObject<HTMLInputElement>;
  openComposer: () => void;
  selectedId: number | null;
  selectAdjacent: (direction: -1 | 1) => void;
  composeReply: (mode: 'reply' | 'replyAll' | 'forward') => void;
  toggleStar: () => void;
  toggleRead: () => void;
  archive: () => void;
  moveTrash: () => void;
  selectAllVisible: () => void;
  undo: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  shortcutHelpOpen: boolean;
  confirmationOpen: boolean;
};

function isTypingTarget(target: EventTarget | null) {
  if (!target || !(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}

export default function useAppShortcuts({
  enabled = true,
  searchInputRef,
  openComposer,
  selectedId,
  selectAdjacent,
  composeReply,
  toggleStar,
  toggleRead,
  archive,
  moveTrash,
  selectAllVisible,
  undo,
  openHelp,
  closeHelp,
  shortcutHelpOpen,
  confirmationOpen,
}: UseAppShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;

      if (shortcutHelpOpen && event.key === 'Escape') {
        event.preventDefault();
        closeHelp();
        return;
      }

      if (confirmationOpen && event.key === 'Escape') return;

      if (mod && key === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (mod && event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        openHelp();
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (mod && key === 'a') {
        event.preventDefault();
        selectAllVisible();
        return;
      }

      if (mod && key === 'z') {
        event.preventDefault();
        undo();
        return;
      }

      if (event.key === '?' && !mod) {
        event.preventDefault();
        openHelp();
        return;
      }

      if (event.key === '/' && !mod) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (!mod && key === 'c') {
        event.preventDefault();
        openComposer();
        return;
      }

      if (!mod && (event.key === 'j' || event.key === 'ArrowDown')) {
        event.preventDefault();
        selectAdjacent(1);
        return;
      }

      if (!mod && (event.key === 'k' || event.key === 'ArrowUp')) {
        event.preventDefault();
        selectAdjacent(-1);
        return;
      }

      if (!selectedId || mod) return;

      if (key === 'r' && !event.shiftKey) {
        event.preventDefault();
        composeReply('reply');
        return;
      }

      if (key === 'r' && event.shiftKey) {
        event.preventDefault();
        composeReply('replyAll');
        return;
      }

      // Gmail / Superhuman-style alias. Keep Shift+R for backward compatibility.
      if (key === 'a') {
        event.preventDefault();
        composeReply('replyAll');
        return;
      }

      if (key === 'f') {
        event.preventDefault();
        composeReply('forward');
        return;
      }

      if (key === 's') {
        event.preventDefault();
        toggleStar();
        return;
      }

      if (key === 'm') {
        event.preventDefault();
        toggleRead();
        return;
      }

      if (key === 'e') {
        event.preventDefault();
        archive();
        return;
      }

      if (event.key === '#' || event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        moveTrash();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    enabled,
    searchInputRef,
    openComposer,
    selectedId,
    selectAdjacent,
    composeReply,
    toggleStar,
    toggleRead,
    archive,
    moveTrash,
    selectAllVisible,
    undo,
    openHelp,
    closeHelp,
    shortcutHelpOpen,
    confirmationOpen,
  ]);

  useEffect(() => {
    // 清理浏览器自动恢复的 search selection，确保持有稳定焦点。
    const input = searchInputRef.current;
    if (!input) return undefined;
    const handleBlur = () => {
      if (input.selectionStart !== input.selectionEnd) {
        input.setSelectionRange(input.selectionEnd, input.selectionEnd);
      }
    };
    input.addEventListener('blur', handleBlur);
    return () => input.removeEventListener('blur', handleBlur);
  }, [searchInputRef]);
}
