import React from 'react';
import {
  FolderOpen,
  MailOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import {
  favoriteFolderKeysStorageKey,
  folderIconForRole,
  folderPreferenceKey,
  isCustomFolder,
  isMovableMessageFolder,
  loadFavoriteFolderKeys,
  primaryFolderRoles,
} from '../app/appConfig';
import type { Folder } from '../app/types';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import {
  hasMessageDragPayload,
  readMessageDragPayload,
} from './messageDrag';

type FolderItemsProps = {
  folders: Folder[];
  folderId: number | null;
  favoriteFolderKeys: Set<string>;
  renamingFolderId: number | null;
  renamingFolderName: string;
  dropTargetFolderId: number | null;
  onSelectFolder: (folderId: number) => void;
  onRenamingFolderNameChange: (value: string) => void;
  onRenameFolder: (folder: Folder) => void;
  onCancelRename: () => void;
  onOpenContextMenu: (event: React.MouseEvent, folder: Folder) => void;
  onDragOverFolder: (event: React.DragEvent<HTMLDivElement>, folder: Folder) => void;
  onDragLeaveFolder: (event: React.DragEvent<HTMLDivElement>, folder: Folder) => void;
  onDropOnFolder: (event: React.DragEvent<HTMLDivElement>, folder: Folder) => void;
};

function FolderItems({
  folders,
  folderId,
  favoriteFolderKeys,
  renamingFolderId,
  renamingFolderName,
  dropTargetFolderId,
  onSelectFolder,
  onRenamingFolderNameChange,
  onRenameFolder,
  onCancelRename,
  onOpenContextMenu,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
}: FolderItemsProps) {
  return folders.map((folder) => {
    const isFavorite = favoriteFolderKeys.has(folderPreferenceKey(folder));
    const hasManagementActions = isCustomFolder(folder) || !primaryFolderRoles.has(folder.role);
    return (
      <div
        key={folder.id}
        className={[
          'folder',
          folder.id === folderId ? 'active' : '',
          isFavorite ? 'favorite' : '',
          folder.id === dropTargetFolderId ? 'message-drop-target' : '',
        ].filter(Boolean).join(' ')}
        data-favorite={isFavorite ? 'true' : undefined}
        data-folder-id={folder.id}
        data-folder-role={folder.role}
        onDragOver={(event) => onDragOverFolder(event, folder)}
        onDragLeave={(event) => onDragLeaveFolder(event, folder)}
        onDrop={(event) => onDropOnFolder(event, folder)}
        onContextMenu={(event) => onOpenContextMenu(event, folder)}
      >
        {renamingFolderId === folder.id ? (
          <form
            className="folder-rename"
            onSubmit={(event) => {
              event.preventDefault();
              onRenameFolder(folder);
            }}
          >
            <input
              value={renamingFolderName}
              onChange={(event) => onRenamingFolderNameChange(event.target.value)}
              autoFocus
            />
            <button type="submit">保存</button>
            <button type="button" onClick={onCancelRename}>取消</button>
          </form>
        ) : (
          <>
            <button type="button" className="folder-main" onClick={() => onSelectFolder(folder.id)}>
              <span className="folder-name">
                {folderIconForRole(folder.role)}
                {folder.name}
              </span>
              {folder.unread_count > 0 && <span className="badge">{folder.unread_count}</span>}
            </button>
            {hasManagementActions && (
              <span className="folder-actions">
                <button
                  type="button"
                  title="更多文件夹操作"
                  aria-label={`${folder.name} 更多操作`}
                  onClick={(event) => onOpenContextMenu(event, folder)}
                >
                  <MoreHorizontal size={14} />
                </button>
              </span>
            )}
          </>
        )}
      </div>
    );
  });
}

export type SidebarFolderNavigationProps = {
  children?: React.ReactNode;
  folders: Folder[];
  folderId: number | null;
  renamingFolderId: number | null;
  renamingFolderName: string;
  onSelectFolder: (folderId: number) => void;
  onDropMessagesToFolder: (folder: Folder, messageIds: number[]) => void;
  onRenamingFolderNameChange: (value: string) => void;
  onRenameFolder: (folder: Folder) => void;
  onCancelRename: () => void;
  onStartRename: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onMarkFolderRead: (folder: Folder) => void;
  onEmptyTrash: () => void;
  onFavoriteChange: (folder: Folder, isFavorite: boolean) => void;
};

export default function SidebarFolderNavigation({
  children,
  folders,
  folderId,
  renamingFolderId,
  renamingFolderName,
  onSelectFolder,
  onDropMessagesToFolder,
  onRenamingFolderNameChange,
  onRenameFolder,
  onCancelRename,
  onStartRename,
  onDeleteFolder,
  onMarkFolderRead,
  onEmptyTrash,
  onFavoriteChange,
}: SidebarFolderNavigationProps) {
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    ariaLabel: string;
    title: string;
    detail: string;
    items: ContextMenuItem[];
  } | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = React.useState<number | null>(null);
  const [favoriteFolderKeys, setFavoriteFolderKeys] = React.useState(loadFavoriteFolderKeys);
  const favoriteFolderKeySet = React.useMemo(
    () => new Set(favoriteFolderKeys),
    [favoriteFolderKeys],
  );
  const primaryFolders = folders.filter((folder) => (
    primaryFolderRoles.has(folder.role) || favoriteFolderKeySet.has(folderPreferenceKey(folder))
  ));
  const secondaryFolders = folders.filter((folder) => (
    !primaryFolderRoles.has(folder.role) && !favoriteFolderKeySet.has(folderPreferenceKey(folder))
  ));

  React.useEffect(() => {
    window.localStorage.setItem(favoriteFolderKeysStorageKey, JSON.stringify(favoriteFolderKeys));
  }, [favoriteFolderKeys]);

  function toggleFavoriteFolder(folder: Folder) {
    const key = folderPreferenceKey(folder);
    const nextFavorite = !favoriteFolderKeySet.has(key);
    setFavoriteFolderKeys((current) => (
      nextFavorite ? [...new Set([...current, key])] : current.filter((item) => item !== key)
    ));
    onFavoriteChange(folder, nextFavorite);
  }

  const folderItemProps = {
    folderId,
    favoriteFolderKeys: favoriteFolderKeySet,
    renamingFolderId,
    renamingFolderName,
    dropTargetFolderId,
    onSelectFolder,
    onRenamingFolderNameChange,
    onRenameFolder,
    onCancelRename,
    onDragOverFolder: (event: React.DragEvent<HTMLDivElement>, folder: Folder) => {
      if (!isMovableMessageFolder(folder) || !hasMessageDragPayload(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTargetFolderId(folder.id);
    },
    onDragLeaveFolder: (event: React.DragEvent<HTMLDivElement>, folder: Folder) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (nextTarget && event.currentTarget.contains(nextTarget)) return;
      setDropTargetFolderId((current) => current === folder.id ? null : current);
    },
    onDropOnFolder: (event: React.DragEvent<HTMLDivElement>, folder: Folder) => {
      if (!isMovableMessageFolder(folder) || !hasMessageDragPayload(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      const messageIds = readMessageDragPayload(event.dataTransfer);
      setDropTargetFolderId(null);
      if (messageIds.length > 0) onDropMessagesToFolder(folder, messageIds);
    },
    onOpenContextMenu: (event: React.MouseEvent, folder: Folder) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = event.currentTarget.getBoundingClientRect();
      const isFavorite = favoriteFolderKeySet.has(folderPreferenceKey(folder));
      const canToggleFavorite = !primaryFolderRoles.has(folder.role);
      setContextMenu({
        x: event.clientX || bounds.right,
        y: event.clientY || bounds.bottom,
        ariaLabel: `${folder.name} 文件夹操作`,
        title: folder.name,
        detail: isCustomFolder(folder) ? '自定义文件夹' : '邮箱文件夹',
        items: [
          {
            id: 'open-folder',
            label: '打开文件夹',
            icon: <FolderOpen size={15} />,
            onSelect: () => onSelectFolder(folder.id),
          },
          {
            id: 'mark-folder-read',
            label: '全部标为已读',
            icon: <MailOpen size={15} />,
            disabled: folder.unread_count <= 0,
            onSelect: () => onMarkFolderRead(folder),
          },
          ...(folder.role === 'trash'
            ? [{
                id: 'empty-trash',
                label: '清空废纸篓',
                icon: <Trash2 size={15} />,
                danger: true,
                separatorBefore: true,
                onSelect: onEmptyTrash,
              }]
            : []),
          ...(canToggleFavorite
            ? [{
                id: isFavorite ? 'unfavorite-folder' : 'favorite-folder',
                label: isFavorite ? '从常用邮箱移除' : '固定到常用邮箱',
                icon: isFavorite ? <PinOff size={15} /> : <Pin size={15} />,
                separatorBefore: true,
                onSelect: () => toggleFavoriteFolder(folder),
              }]
            : []),
          ...(isCustomFolder(folder)
            ? [
                {
                  id: 'rename-folder',
                  label: '重命名',
                  icon: <Pencil size={15} />,
                  separatorBefore: true,
                  onSelect: () => onStartRename(folder),
                },
                {
                  id: 'delete-folder',
                  label: '删除文件夹',
                  icon: <Trash2 size={15} />,
                  danger: true,
                  onSelect: () => onDeleteFolder(folder),
                },
              ]
            : []),
        ],
      });
    },
  };

  return (
    <>
      <div className="sidebar-label">邮箱</div>
      <nav className="folder-list primary-folder-list">
        <FolderItems folders={primaryFolders} {...folderItemProps} />
      </nav>

      <div className="sidebar-secondary sidebar-quick-menus">
        {secondaryFolders.length > 0 && (
          <details className="sidebar-disclosure more-mailboxes">
            <summary>
              <span>更多邮箱</span>
            </summary>
            <nav className="folder-list folded-folder-list">
              <FolderItems folders={secondaryFolders} {...folderItemProps} />
            </nav>
          </details>
        )}
        {children}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          title={contextMenu.title}
          detail={contextMenu.detail}
          ariaLabel={contextMenu.ariaLabel}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
