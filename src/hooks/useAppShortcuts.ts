import { useEffect, useRef, type RefObject } from 'react';
import type { ListMode, Message, MessageSummary, UndoAction } from '../app/types';

type BulkAction = 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'trash';
type ComposeMode = 'reply' | 'replyAll' | 'forward';

type UseAppShortcutsOptions = {
  searchInputRef: RefObject<HTMLInputElement>;
  messages: MessageSummary[];
  selected: MessageSummary | null;
  selectedId: number | null;
  selectedMessages: MessageSummary[];
  selectedMessageIds: number[];
  listMode: ListMode;
  undoAction: UndoAction | null;
  isComposerOpen: boolean;
  isComposerMinimized: boolean;
  isSettingsOpen: boolean;
  isShortcutsOpen: boolean;
  isCommandPaletteOpen: boolean;
  closeOverlays: () => void;
  clearSelection: () => void;
  setStatus: (status: string) => void;
  restoreUndoAction: () => Promise<void>;
  toggleAllVisibleMessages: (checked: boolean) => void;
  openCommandPalette: () => void;
  openShortcuts: () => void;
  composeNew: () => void;
  setSelectedId: (messageId: number) => void;
  runBulkAction: (action: BulkAction) => Promise<void>;
  composeFromMessage: (message: MessageSummary, mode: ComposeMode) => void;
  toggleStar: (message: MessageSummary) => Promise<void>;
  toggleRead: (message: MessageSummary) => Promise<void>;
  moveSelected: (role: 'archive' | 'trash') => Promise<void>;
};

export default function useAppShortcuts(options: UseAppShortcutsOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
    }

    function selectRelativeMessage(offset: number) {
      const { messages, selectedId, setSelectedId } = optionsRef.current;
      if (messages.length === 0) return;
      const currentIndex = selectedId ? messages.findIndex((message) => message.id === selectedId) : -1;
      const nextIndex = Math.min(Math.max(currentIndex + offset, 0), messages.length - 1);
      setSelectedId(messages[nextIndex].id);
    }

    function runSafely(action: Promise<void>) {
      const { setStatus } = optionsRef.current;
      action.catch((error) => setStatus(String(error)));
    }

    function handleShortcut(event: KeyboardEvent) {
      const {
        searchInputRef,
        messages,
        selected,
        selectedMessages,
        selectedMessageIds,
        listMode,
        undoAction,
        isComposerOpen,
        isComposerMinimized,
        isSettingsOpen,
        isShortcutsOpen,
        isCommandPaletteOpen,
        closeOverlays,
        clearSelection,
        setStatus,
        restoreUndoAction,
        toggleAllVisibleMessages,
        openCommandPalette,
        openShortcuts,
        composeNew,
        runBulkAction,
        composeFromMessage,
        toggleStar,
        toggleRead,
        moveSelected,
      } = optionsRef.current;
      const key = event.key.toLowerCase();
      const editable = isEditableTarget(event.target);
      const commandModifier = event.metaKey || event.ctrlKey;

      if (key === 'escape' && (isComposerOpen || isSettingsOpen || isShortcutsOpen || isCommandPaletteOpen)) {
        event.preventDefault();
        closeOverlays();
        return;
      }
      if (editable) return;

      const hasBlockingOverlay = isSettingsOpen
        || isShortcutsOpen
        || isCommandPaletteOpen
        || (isComposerOpen && !isComposerMinimized);
      if (hasBlockingOverlay) return;

      if (key === 'escape' && document.querySelector('.context-menu')) {
        return;
      }

      if (key === 'escape' && selectedMessageIds.length > 0) {
        event.preventDefault();
        clearSelection();
        setStatus('已取消邮件选择');
        return;
      }

      if (commandModifier && !event.shiftKey && key === 'z' && undoAction) {
        event.preventDefault();
        runSafely(restoreUndoAction());
        return;
      }

      if (commandModifier && !event.shiftKey && key === 'a' && listMode === 'messages' && messages.length > 0) {
        event.preventDefault();
        toggleAllVisibleMessages(true);
        setStatus(`已选择当前列表 ${messages.length} 封邮件`);
        return;
      }

      if (commandModifier && key === 'k') {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if (commandModifier && key === '/') {
        event.preventDefault();
        openShortcuts();
        return;
      }

      if (commandModifier || event.altKey) return;

      if (key === '?' || (event.shiftKey && key === '/')) {
        event.preventDefault();
        openShortcuts();
        return;
      }

      if (key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (key === 'c') {
        event.preventDefault();
        composeNew();
        return;
      }
      if (key === 'j' || key === 'arrowdown') {
        event.preventDefault();
        selectRelativeMessage(1);
        return;
      }
      if (key === 'k' || key === 'arrowup') {
        event.preventDefault();
        selectRelativeMessage(-1);
        return;
      }

      if (selectedMessages.length > 0) {
        if (key === 's') {
          event.preventDefault();
          const action = selectedMessages.every((message) => message.is_starred) ? 'unstar' : 'star';
          runSafely(runBulkAction(action));
          return;
        }
        if (key === 'm') {
          event.preventDefault();
          const action = selectedMessages.every((message) => message.is_read) ? 'unread' : 'read';
          runSafely(runBulkAction(action));
          return;
        }
        if (key === 'e') {
          event.preventDefault();
          runSafely(runBulkAction('archive'));
          return;
        }
        if (key === 'delete' || key === 'backspace') {
          event.preventDefault();
          runSafely(runBulkAction('trash'));
          return;
        }
      }

      if (!selected) return;
      if (key === 'r' && event.shiftKey) {
        event.preventDefault();
        composeFromMessage(selected, 'replyAll');
      } else if (key === 'r') {
        event.preventDefault();
        composeFromMessage(selected, 'reply');
      } else if (key === 'f') {
        event.preventDefault();
        composeFromMessage(selected, 'forward');
      } else if (key === 's') {
        event.preventDefault();
        runSafely(toggleStar(selected));
      } else if (key === 'm') {
        event.preventDefault();
        runSafely(toggleRead(selected));
      } else if (key === 'e') {
        event.preventDefault();
        runSafely(moveSelected('archive'));
      } else if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        runSafely(moveSelected('trash'));
      }
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);
}
