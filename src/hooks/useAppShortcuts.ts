import { useEffect, useRef, type RefObject } from 'react';
import type { ListMode, MessageSummary, UndoAction } from '../app/types';
import {
  canArchiveMessageRole,
  canChangeMessageReadStateRole,
  canMoveMessageToTrashRole,
  buildMessageCollectionActionState,
  messagesForCollectionAction,
  type BulkMessageAction,
} from '../app/messageActionState';

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
  isComposerModal: boolean;
  isSettingsOpen: boolean;
  isShortcutsOpen: boolean;
  isAccountLoginRequired: boolean;
  closeOverlays: () => void;
  clearSelection: () => void;
  setStatus: (status: string) => void;
  restoreUndoAction: () => Promise<void>;
  toggleAllVisibleMessages: (checked: boolean) => void | Promise<number | null>;
  openShortcuts: () => void;
  composeNew: () => void;
  setSelectedId: (messageId: number) => void;
  runBulkAction: (action: BulkMessageAction) => Promise<void>;
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

    function hasActiveTextSelection(): boolean {
      const selection = window.getSelection();
      return Boolean(selection && !selection.isCollapsed && selection.toString());
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

    function isInteractiveOverlayTarget(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          '[role="dialog"], [role="menu"], [role="listbox"], [role="combobox"], ' +
          '.context-menu, .context-menu-surface, .message-date-picker-popover, ' +
          '.custom-select-menu, .custom-select-dropdown, .custom-select-summary[aria-expanded="true"]'
        )
      );
    }

    function handleShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.isComposing || event.keyCode === 229) return;
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
        isComposerModal,
        isSettingsOpen,
        isShortcutsOpen,
        isAccountLoginRequired,
        closeOverlays,
        clearSelection,
        setStatus,
        restoreUndoAction,
        toggleAllVisibleMessages,
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
      const inInteractiveOverlay = isInteractiveOverlayTarget(event.target);
      const hasActivePopup = Boolean(document.querySelector('.message-date-picker-popover, .context-menu, .custom-select-menu'));
      const commandModifier = event.metaKey || event.ctrlKey;

      if (isAccountLoginRequired) return;
      if (document.body.dataset.imagePreviewModal === '1') return;

      if (key === 'escape' && (isComposerOpen || isSettingsOpen || isShortcutsOpen)) {
        event.preventDefault();
        closeOverlays();
        return;
      }
      const withinComposer = event.target instanceof Element && Boolean(event.target.closest('.composer, .composer-minimized'));
      if (withinComposer) return;
      const hasBlockingOverlay = isSettingsOpen
        || isShortcutsOpen
        || (isComposerOpen && !isComposerMinimized && isComposerModal);
      if (hasBlockingOverlay) return;

      if (commandModifier && !event.shiftKey && key === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (editable || inInteractiveOverlay) return;
      if (hasActivePopup && ['j', 'k', 'arrowdown', 'arrowup', 's', 'm', 'e', 'd'].includes(key)) return;

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

      if (
        commandModifier
        && !event.shiftKey
        && key === 'a'
        && listMode === 'messages'
        && messages.length > 0
        && !hasActiveTextSelection()
      ) {
        event.preventDefault();
        const selectionResult = toggleAllVisibleMessages(true);
        if (selectionResult && typeof selectionResult.then === 'function') {
          setStatus('正在选择当前列表中的全部邮件');
          void selectionResult.then((count) => {
            if (typeof count === 'number') {
              setStatus(`已选择当前列表 ${count} 封邮件`);
            }
          });
        } else {
          setStatus(`已选择当前列表 ${messages.length} 封邮件`);
        }
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
      if (listMode === 'messages' && (key === 'j' || key === 'arrowdown')) {
        event.preventDefault();
        selectRelativeMessage(1);
        return;
      }
      if (listMode === 'messages' && (key === 'k' || key === 'arrowup')) {
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
          const state = buildMessageCollectionActionState(selectedMessages);
          const readAction = state.entries.find((item) => item.action === 'read' || item.action === 'unread');
          if (readAction && readAction.action !== 'snooze') runSafely(runBulkAction(readAction.action));
          else setStatus('所选邮件没有可更改的已读状态');
          return;
        }
        if (key === 'e') {
          event.preventDefault();
          if (messagesForCollectionAction(selectedMessages, 'archive').length > 0) {
            runSafely(runBulkAction('archive'));
          } else {
            setStatus('所选邮件无法归档');
          }
          return;
        }
        if (key === '#' || key === 'delete' || key === 'backspace') {
          event.preventDefault();
          if (messagesForCollectionAction(selectedMessages, 'trash').length > 0) {
            runSafely(runBulkAction('trash'));
          } else {
            setStatus('废纸篓中的邮件需使用“永久删除”并确认');
          }
          return;
        }
      }

      if (!selected) return;
      if (key === 'a' && !event.shiftKey) {
        event.preventDefault();
        composeFromMessage(selected, 'replyAll');
      } else if (key === 'r' && event.shiftKey) {
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
        if (canChangeMessageReadStateRole(selected.folder_role)) runSafely(toggleRead(selected));
        else setStatus('这封邮件没有可更改的已读状态');
      } else if (key === 'e') {
        event.preventDefault();
        if (canArchiveMessageRole(selected.folder_role)) runSafely(moveSelected('archive'));
        else setStatus('这封邮件无法归档');
      } else if (key === '#' || key === 'delete' || key === 'backspace') {
        event.preventDefault();
        if (canMoveMessageToTrashRole(selected.folder_role)) runSafely(moveSelected('trash'));
        else setStatus('废纸篓中的邮件需使用“永久删除”并确认');
      }
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);
}
