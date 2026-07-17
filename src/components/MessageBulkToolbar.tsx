import {
  MoreHorizontal,
} from 'lucide-react';
import { movableFoldersForBulk } from '../app/appConfig';
import { canSnoozeRole } from '../app/snooze';
import type {
  Folder,
  Label,
  Message,
  MessageSummary,
} from '../app/types';
import type { BulkMessageAction } from './messageContextMenu';

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
      <details className="compact-menu bulk-more-menu">
        <summary>
          <MoreHorizontal size={15} />
          操作
        </summary>
        <div>
          <button type="button" onClick={() => onRunBulkAction('star')}>星标</button>
          <button type="button" onClick={() => onRunBulkAction('trash')}>删除</button>
          <button type="button" onClick={() => onRunBulkAction('read')}>标为已读</button>
          <button type="button" onClick={() => onRunBulkAction('unread')}>标为未读</button>
          <button
            type="button"
            disabled={snoozableSelectedMessages.length === 0}
            onClick={() => onRequestSnooze(snoozableSelectedMessages)}
          >
            稍后处理
          </button>
          <span className="menu-section-title">移动到</span>
          {movableFoldersForBulk(folders, selectedMessages).map((folder) => (
            <button
              type="button"
              key={folder.id}
              disabled={selectedMessages.length === 0}
              onClick={() => onMoveBulkToFolder(folder)}
            >
              {folder.name}
            </button>
          ))}
          <span className="menu-section-title">打标签</span>
          {labels.map((label) => (
            <button type="button" key={label.id} onClick={() => onToggleBulkLabel(label)}>
              <span className="label-dot" style={{ background: label.color }} />
              {label.name}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
