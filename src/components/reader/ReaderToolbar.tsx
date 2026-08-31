import {
  Archive,
  Clock,
  Download,
  Languages,
  Loader2,
  MailOpen,
  MoreHorizontal,
  RefreshCw,
  Reply,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Star,
  Trash2,
} from 'lucide-react';
import { canSnoozeRole } from '../../app/snooze';
import {
  canArchiveMessageRole,
  canReplyToMessageRole,
} from '../../app/messageActionState';
import type { Folder, Message } from '../../app/types';
import SenderIdentity from './SenderIdentity';
import ReaderAiContextActions from './ReaderAiContextActions';
import { useDetailsMenu } from '../../hooks/useDetailsMenu';
import { memo, useRef } from 'react';
import {
  buildSingleMessageContextItems,
  type MessageContextAction,
} from '../messageContextMenu';
import { ContextMenuContent, type ContextMenuItem } from '../ContextMenu';

export type ComposeMode = 'reply' | 'replyAll' | 'forward';

type ReaderToolbarProps = {
  selected: Message;
  folders: Folder[];
  selectedSenderTrusted: boolean;
  selectedSenderDomain: string;
  selectedExternalBlocked: boolean;
  onTrustRemoteImages: (scope: 'sender' | 'domain') => void;
  onBlockSender: () => void;
  needsTranslation: boolean;
  translationActive: boolean;
  translationCompleted: boolean;
  translationLoading: boolean;
  onTranslateMessage: () => void;
  onToggleTranslation: () => void;
  onToggleStar: (message: Message) => void;
  onEditDraft: (message: Message) => void;
  onComposeNew?: (fields: { to: string }) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode, prefillBody?: string) => void;
  onRestoreFromTrash: () => void;
  onMoveArchive: () => void;
  onToggleRead: (message: Message) => void;
  onMoveTrash: () => void;
  onUnsnooze: () => void;
  onSnooze: () => void;
  onExportMessage: () => void;
  onFetchBody: (isSilent?: boolean) => void | Promise<void>;
  onMarkNotSpam: () => void;
  onMarkAsSpam: () => void;
  onPermanentlyDelete: () => void;
  onEmptyTrash: () => void;
  onMoveToFolder: (folder: Folder) => void;
};

function ReaderToolbar({
  selected,
  folders,
  selectedSenderTrusted,
  selectedSenderDomain,
  selectedExternalBlocked,
  onTrustRemoteImages,
  onBlockSender,
  needsTranslation,
  translationActive,
  translationCompleted,
  translationLoading,
  onTranslateMessage,
  onToggleTranslation,
  onToggleStar,
  onEditDraft,
  onComposeNew,
  onComposeFromMessage,
  onRestoreFromTrash,
  onMoveArchive,
  onToggleRead,
  onMoveTrash,
  onUnsnooze,
  onSnooze,
  onExportMessage,
  onFetchBody,
  onMarkNotSpam,
  onMarkAsSpam,
  onPermanentlyDelete,
  onEmptyTrash,
  onMoveToFolder,
}: ReaderToolbarProps) {
  const isDraft = selected.folder_role === 'drafts';
  const isTrash = selected.folder_role === 'trash';
  const canReply = canReplyToMessageRole(selected.folder_role);
  const canArchive = canArchiveMessageRole(selected.folder_role);
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenu = useDetailsMenu(moreMenuRef, { floating: true });
  const runContextAction = (action: MessageContextAction) => {
    switch (action) {
      case 'read':
      case 'unread':
        onToggleRead(selected);
        break;
      case 'star':
      case 'unstar':
        onToggleStar(selected);
        break;
      case 'archive':
        onMoveArchive();
        break;
      case 'trash':
        onMoveTrash();
        break;
      case 'restore':
        onRestoreFromTrash();
        break;
      case 'snooze':
        onSnooze();
        break;
      case 'unsnooze':
        onUnsnooze();
        break;
      case 'spam':
        onMarkAsSpam();
        break;
      case 'not-spam':
        onMarkNotSpam();
        break;
      case 'permanent-delete':
        onPermanentlyDelete();
        break;
      case 'copy-sender':
      case 'copy-subject':
        break;
    }
  };
  const readerMenuItems = buildSingleMessageContextItems({
    message: selected,
    folders,
    labels: [],
    onSelectMessage: () => {},
    onComposeFromMessage: (_message, mode) => onComposeFromMessage(selected, mode),
    onRunMessageAction: (_message, action) => runContextAction(action),
    onMoveMessageToFolder: (_message, folder) => onMoveToFolder(folder),
    onToggleMessageLabel: () => {},
  }).filter((item) => ![
    'open',
    'reply',
    'star-state',
    'snooze',
    'unsnooze',
    'archive',
    'restore',
    'copy-message-info',
  ].includes(item.id));
  const extraItems: ContextMenuItem[] = [
    {
      id: 'export-eml',
      label: '导出 EML',
      icon: <Download size={15} />,
      separatorBefore: true,
      onSelect: onExportMessage,
    },
    ...(selected.remote_uid > 0 && !selected.body.trim()
      ? [{
          id: 'fetch-body',
          label: '重新获取正文',
          icon: <RefreshCw size={15} />,
          onSelect: () => void onFetchBody(false),
        }]
      : []),
    ...(!isDraft && selected.sender_email.trim()
      ? [{
          id: 'sender-safety',
          label: '发件人安全',
          icon: <ShieldCheck size={15} />,
          separatorBefore: true,
          children: [
            ...(!selectedSenderTrusted && !selectedExternalBlocked
              ? [{
                  id: 'trust-sender',
                  label: '信任发件人',
                  icon: <ShieldCheck size={15} />,
                  onSelect: () => onTrustRemoteImages('sender'),
                }]
              : []),
            ...(selectedSenderDomain && !selectedSenderTrusted && !selectedExternalBlocked
              ? [{
                  id: 'trust-domain',
                  label: `信任 ${selectedSenderDomain}`,
                  icon: <ShieldCheck size={15} />,
                  onSelect: () => onTrustRemoteImages('domain'),
                }]
              : []),
            {
              id: 'block-sender',
              label: '阻止该发件人',
              icon: <ShieldOff size={15} />,
              onSelect: onBlockSender,
            },
          ],
        }]
      : []),
  ];
  const dangerIndex = readerMenuItems.findIndex((item) => item.danger);
  readerMenuItems.splice(dangerIndex < 0 ? readerMenuItems.length : dangerIndex, 0, ...extraItems);
  if (isTrash) {
    readerMenuItems.push({
      id: 'empty-trash',
      label: '清空废纸篓',
      icon: <Trash2 size={15} />,
      danger: true,
      onSelect: onEmptyTrash,
    });
  }

  return (
    <header className="reader-header">
      <div className="reader-title-block">
        <h1>{selected.subject || '(无主题)'}</h1>
        <SenderIdentity message={selected} onComposeNew={onComposeNew} />
      </div>
      <div className="reader-actions" aria-label="邮件操作">
        {isDraft ? (
          <div className="reader-action-group reader-response-actions" role="group" aria-label="草稿操作">
            <button className="primary-action" title="继续编辑草稿" onClick={() => onEditDraft(selected)}>
              <MailOpen size={16} />
              <span>继续编辑</span>
            </button>
          </div>
        ) : canReply ? (
          <div className="reader-action-group reader-response-actions" role="group" aria-label="回复操作">
            <button className="primary-action" title="回复" onClick={() => onComposeFromMessage(selected, 'reply')}>
              <Reply size={16} />
              <span>回复</span>
            </button>
          </div>
        ) : null}
        <div className="reader-action-group reader-message-actions" role="group" aria-label="整理操作">
          <button
            className="icon-only-action"
            title={selected.is_starred ? '取消星标' : '添加星标'}
            aria-label={selected.is_starred ? '取消星标' : '添加星标'}
            onClick={() => onToggleStar(selected)}
          >
            <Star size={17} fill={selected.is_starred ? 'currentColor' : 'none'} />
          </button>
          {isTrash ? (
            <button title="恢复到收件箱" aria-label="恢复到收件箱" onClick={onRestoreFromTrash}>
              <RotateCcw size={16} />
              <span>恢复到收件箱</span>
            </button>
          ) : canArchive && (
            <button className="icon-only-action" aria-label="归档" title="归档" onClick={onMoveArchive}>
              <Archive size={16} />
            </button>
          )}
          {selected.folder_role === 'snoozed' ? (
            <button
              className="icon-only-action"
              aria-label="取消稍后处理"
              title="取消稍后处理"
              onClick={onUnsnooze}
            >
              <Clock size={16} />
            </button>
          ) : canSnoozeRole(selected.folder_role) && (
            <button
              className="icon-only-action"
              aria-label="稍后处理"
              title="稍后处理"
              onClick={onSnooze}
            >
              <Clock size={16} />
            </button>
          )}
        </div>
        {!isDraft && needsTranslation && (
          <button
            type="button"
            className={`reader-translate-action${translationActive ? ' active' : ''}`}
            title="检测到外语邮件，点击翻译为中文"
            aria-label={translationActive ? '显示原文' : '翻译为中文'}
            onClick={translationCompleted ? onToggleTranslation : onTranslateMessage}
            disabled={translationLoading}
          >
            {translationLoading ? (
              <Loader2 size={15} className="reader-translation-spinner" />
            ) : (
              <Languages size={15} />
            )}
            <span>{translationActive ? '显示原文' : '翻译为中文'}</span>
          </button>
        )}
        {!isDraft && (
          <ReaderAiContextActions
            message={selected}
            onComposeFromMessage={onComposeFromMessage}
          />
        )}
        <details
          className="reader-more-menu compact-menu"
          ref={moreMenuRef}
          data-floating-menu="true"
        >
          <summary className="icon-only-summary" title="更多操作" aria-label="更多操作">
            <MoreHorizontal size={17} />
          </summary>
          <div
            className="context-menu-surface context-menu--anchored reader-more-menu-panel"
            data-floating-menu-panel="true"
          >
            <ContextMenuContent
              items={readerMenuItems}
              onClose={moreMenu.closeMenu}
              ariaLabel="邮件操作"
              title={selected.subject || '(无主题)'}
              detail={selected.sender_name || selected.sender_email}
            />
          </div>
        </details>
      </div>
    </header>
  );
}

export default memo(ReaderToolbar);
