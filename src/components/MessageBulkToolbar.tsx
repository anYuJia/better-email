import {
  MoreHorizontal,
  X,
} from 'lucide-react';
import { useRef } from 'react';
import {
  buildMessageCollectionActionState,
  collectionActionDetail,
  primaryMessageCollectionActions,
  type MessageCollectionActionEntry,
} from '../app/messageActionState';
import type {
  Folder,
  Label,
  MessageSummary,
} from '../app/types';
import {
  buildBulkMessageContextItems,
  type BulkMessageAction,
} from './messageContextMenu';
import { ContextMenuContent } from './ContextMenu';
import { useDetailsMenu } from '../hooks/useDetailsMenu';

type MessageBulkToolbarProps = {
  selectedMessageIds: number[];
  selectedMessages: MessageSummary[];
  folders: Folder[];
  labels: Label[];
  onRunBulkAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: MessageSummary[]) => void;
  onMoveBulkToFolder: (folder: Folder) => void;
  onToggleBulkLabel: (label: Label) => void;
  inline?: boolean;
  onClearSelection?: () => void;
};

export default function MessageBulkToolbar({
  selectedMessageIds,
  selectedMessages,
  folders,
  labels,
  onRunBulkAction,
  onRequestSnooze,
  onMoveBulkToFolder,
  onToggleBulkLabel,
  inline = false,
  onClearSelection,
}: MessageBulkToolbarProps) {
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenu = useDetailsMenu(moreMenuRef, { floating: true });
  if (selectedMessageIds.length === 0) return null;

  const actionState = buildMessageCollectionActionState(selectedMessages);
  const actions = primaryMessageCollectionActions(actionState);
  const primaryActions = inline ? actions.slice(0, 1) : actions;
  const primaryContextItemIds = new Set(primaryActions.map((item) => {
    if (item.action === 'read' || item.action === 'unread') return 'bulk-read-state';
    if (item.action === 'star' || item.action === 'unstar') return 'bulk-star-state';
    return `bulk-${item.action}`;
  }));
  const moreMenuItems = buildBulkMessageContextItems({
    selectedMessages,
    folders,
    labels,
    onRunBulkAction,
    onRequestSnooze,
    onMoveBulkToFolder,
    onToggleBulkLabel,
  }).filter((item) => !primaryContextItemIds.has(item.id));

  const runAction = (item: MessageCollectionActionEntry) => {
    if (item.action === 'snooze') {
      onRequestSnooze(item.messages);
    } else {
      onRunBulkAction(item.action);
    }
  };
  const actionTitle = (item: MessageCollectionActionEntry) => (
    `${item.label} · ${collectionActionDetail(item.messages.length, actionState.totalCount)}`
  );

  return (
    <div className={`bulk-toolbar active${inline ? ' bulk-toolbar-inline' : ''}`}>
      {primaryActions.map((item) => (
        <button
          key={item.action}
          type="button"
          className={item.danger ? 'bulk-delete-action' : 'bulk-primary-action'}
          aria-label={`对选中的邮件执行：${item.label}`}
          title={actionTitle(item)}
          onClick={() => runAction(item)}
        >
          {inline && item.action === 'restore' ? '恢复' : item.label}
        </button>
      ))}
      <details
        className="compact-menu bulk-more-menu"
        ref={moreMenuRef}
        data-floating-menu="true"
      >
        <summary
          role="button"
          aria-label={`更多批量操作，已选 ${selectedMessageIds.length} 封`}
        >
          <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
          {!inline && <span aria-live="polite">已选 {selectedMessageIds.length} 封</span>}
        </summary>
        <div
          className="context-menu-surface context-menu--anchored"
          data-floating-menu-panel="true"
        >
          <ContextMenuContent
            title={`已选 ${selectedMessageIds.length} 封邮件`}
            detail="更多批量操作"
            ariaLabel="更多批量操作"
            items={moreMenuItems}
            onClose={moreMenu.closeMenu}
          />
        </div>
      </details>
      {onClearSelection && <button type="button" className="bulk-exit-selection"
        aria-label="退出选择" title="退出选择" onClick={onClearSelection}>
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>}
    </div>
  );
}
