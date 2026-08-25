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
  isSelectingAll?: boolean;
  inline?: boolean;
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
  isSelectingAll = false,
  inline = false,
}: MessageBulkToolbarProps) {
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenu = useDetailsMenu(moreMenuRef, { floating: true });
  if (selectedMessageIds.length === 0) return null;

  const allVisibleSelected = visibleMessageCount > 0 && selectedMessageIds.length === visibleMessageCount;
  const snoozableSelectedMessages = selectedMessages.filter((message) => canSnoozeRole(message.folder_role));

  return (
    <div className={`bulk-toolbar active${inline ? ' bulk-toolbar-inline' : ''}`}>
      <label className="bulk-selection" title="选择或取消选择当前筛选结果中的全部邮件">
        <input
          type="checkbox"
          aria-label={isSelectingAll ? '正在选择全部邮件' : '选择当前列表中的全部邮件'}
          checked={allVisibleSelected}
          disabled={isSelectingAll}
          onChange={(event) => onToggleAllVisible(event.target.checked)}
        />
        <span>{isSelectingAll ? '正在选择…' : `已选 ${selectedMessageIds.length}`}</span>
      </label>
      <button
        type="button"
        className="bulk-primary-action"
        aria-label="归档选中的邮件"
        onClick={() => onRunBulkAction('archive')}
      >
        归档
      </button>
      <button
        type="button"
        className="bulk-delete-action"
        aria-label="删除选中的邮件"
        onClick={() => onRunBulkAction('trash')}
      >
        删除
      </button>
      <details
        className="compact-menu bulk-more-menu"
        ref={moreMenuRef}
        data-floating-menu="true"
      >
        <summary
          role="button"
          aria-label={`更多批量操作，已选 ${selectedMessageIds.length} 封`}
        >
          <MoreHorizontal size={15} aria-hidden="true" />
          更多
        </summary>
        <div>
          <button type="button" onClick={() => { onRunBulkAction('star'); moreMenu.closeMenu(); }}>星标</button>
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
