import {
  MoreHorizontal,
} from 'lucide-react';
import { useRef } from 'react';
import { movableFoldersForBulk } from '../app/appConfig';
import { canSnoozeRole } from '../app/snooze';
import type {
  Folder,
  Label,
  MessageSummary,
} from '../app/types';
import type { BulkMessageAction } from './messageContextMenu';
import { useDetailsMenu } from '../hooks/useDetailsMenu';

type MessageBulkToolbarProps = {
  visibleMessageCount: number;
  selectedMessageIds: number[];
  selectedMessages: MessageSummary[];
  folders: Folder[];
  labels: Label[];
  onToggleAllVisible: (checked: boolean) => void;
  onRunBulkAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: MessageSummary[]) => void;
  onMoveBulkToFolder: (folder: Folder) => void;
  onToggleBulkLabel: (label: Label) => void;
};

export default function MessageBulkToolbar({
  visibleMessageCount,
  selectedMessageIds,
  selectedMessages,
  folders,
  labels,
  onToggleAllVisible,
  onRunBulkAction,
  onRequestSnooze,
  onMoveBulkToFolder,
  onToggleBulkLabel,
}: MessageBulkToolbarProps) {
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenu = useDetailsMenu(moreMenuRef, { floating: true });
  if (selectedMessageIds.length === 0) return null;

  const allVisibleSelected = visibleMessageCount > 0 && selectedMessageIds.length === visibleMessageCount;
  const snoozableSelectedMessages = selectedMessages.filter((message) => canSnoozeRole(message.folder_role));

  return (
    <div className="bulk-toolbar active">
      <label className="bulk-selection">
        <input
          type="checkbox"
          checked={allVisibleSelected}
          onChange={(event) => onToggleAllVisible(event.target.checked)}
        />
        <span>已选 {selectedMessageIds.length}</span>
      </label>
      <button type="button" className="bulk-primary-action" onClick={() => onRunBulkAction('archive')}>归档</button>
      <details
        className="compact-menu bulk-more-menu"
        ref={moreMenuRef}
        data-floating-menu="true"
      >
        <summary aria-label={`更多批量操作，已选 ${selectedMessageIds.length} 封`}>
          <MoreHorizontal size={15} aria-hidden="true" />
          操作
        </summary>
        <div>
          <button type="button" onClick={() => { onRunBulkAction('star'); moreMenu.closeMenu(); }}>星标</button>
          <button type="button" onClick={() => { onRunBulkAction('trash'); moreMenu.closeMenu(); }}>删除</button>
          <button type="button" onClick={() => { onRunBulkAction('read'); moreMenu.closeMenu(); }}>标为已读</button>
          <button type="button" onClick={() => { onRunBulkAction('unread'); moreMenu.closeMenu(); }}>标为未读</button>
          <button
            type="button"
            disabled={snoozableSelectedMessages.length === 0}
            onClick={() => { onRequestSnooze(snoozableSelectedMessages); moreMenu.closeMenu(); }}
          >
            稍后处理
          </button>
          <span className="menu-section-title">移动到</span>
          {movableFoldersForBulk(folders, selectedMessages).map((folder) => (
            <button
              type="button"
              key={folder.id}
              disabled={selectedMessages.length === 0}
              onClick={() => { onMoveBulkToFolder(folder); moreMenu.closeMenu(); }}
            >
              {folder.name}
            </button>
          ))}
          <span className="menu-section-title">打标签</span>
          {labels.map((label) => (
            <button type="button" key={label.id} onClick={() => { onToggleBulkLabel(label); moreMenu.closeMenu(); }}>
              <span className="label-dot" style={{ background: label.color }} />
              {label.name}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
