import {
  Archive,
  Clock,
  ChevronDown,
  Forward,
  Languages,
  Loader2,
  Mail,
  MailOpen,
  MoreHorizontal,
  Reply,
  ReplyAll,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import { movableFoldersForMessage } from '../../app/appConfig';
import { canSnoozeRole } from '../../app/snooze';
import type { Folder, Message } from '../../app/types';
import SenderIdentity from './SenderIdentity';
import { useDetailsMenu } from '../../hooks/useDetailsMenu';
import { memo, useMemo, useRef } from 'react';

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
  onComposeFromMessage: (message: Message, mode: ComposeMode) => void;
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
  const replyMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const replyMenu = useDetailsMenu(replyMenuRef);
  const moreMenu = useDetailsMenu(moreMenuRef);
  const movableFolders = useMemo(
    () => movableFoldersForMessage(folders, selected),
    [folders, selected],
  );

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
        ) : (
          <div className="reader-action-group reader-response-actions" role="group" aria-label="回复操作">
            <button className="primary-action" title="回复" onClick={() => onComposeFromMessage(selected, 'reply')}>
              <Reply size={16} />
              <span>回复</span>
            </button>
            <details className="reader-reply-menu compact-menu" ref={replyMenuRef}>
              <summary className="icon-only-summary reader-reply-menu-summary" title="更多回复方式" aria-label="更多回复方式">
                <ChevronDown size={14} />
              </summary>
              <div onClick={() => replyMenu.closeMenu()}>
                <button type="button" onClick={() => onComposeFromMessage(selected, 'replyAll')}>
                  <ReplyAll size={16} />
                  <span>回复全部</span>
                </button>
                <button type="button" onClick={() => onComposeFromMessage(selected, 'forward')}>
                  <Forward size={16} />
                  <span>转发</span>
                </button>
              </div>
            </details>
          </div>
        )}
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
            <button title="恢复邮件" onClick={onRestoreFromTrash}>
              <RotateCcw size={16} />
              <span>恢复</span>
            </button>
          ) : !isDraft && (
            <button className="icon-only-action" aria-label="归档" title="归档" onClick={onMoveArchive}>
              <Archive size={16} />
            </button>
          )}
        </div>
        <details className="reader-more-menu compact-menu" ref={moreMenuRef}>
          <summary className="icon-only-summary" title="更多操作" aria-label="更多操作">
            <MoreHorizontal size={17} />
          </summary>
          <div onClick={() => moreMenu.closeMenu()}>
            <span className="menu-section-title">整理</span>
            {selected.folder_role === 'snoozed' ? (
              <button onClick={onUnsnooze}><Clock size={16} /> 取消稍后</button>
            ) : canSnoozeRole(selected.folder_role) && (
              <button onClick={onSnooze}><Clock size={16} /> 稍后处理</button>
            )}
            {!isDraft && (
              <button onClick={() => onToggleRead(selected)}>
                <Mail size={16} />
                {selected.is_read ? '标为未读' : '标为已读'}
              </button>
            )}
            {!isTrash && (
              <button className="danger-menu-item" onClick={onMoveTrash}>
                <Trash2 size={16} /> 删除
              </button>
            )}
            <button onClick={onExportMessage}>导出 EML</button>
            {selected.remote_uid > 0 && !selected.body.trim() && (
              <button onClick={() => onFetchBody(false)}>拉取正文</button>
            )}
            {selected.folder_role === 'spam' ? (
              <button onClick={onMarkNotSpam}>不是垃圾邮件</button>
            ) : (
              <button onClick={onMarkAsSpam}>标为垃圾邮件</button>
            )}

            {!isDraft && selected.sender_email.trim() && (
              <>
                <span className="menu-section-title">安全</span>
                {!selectedSenderTrusted && !selectedExternalBlocked && (
                  <button onClick={() => onTrustRemoteImages('sender')}>信任发件人</button>
                )}
                {selectedSenderDomain && !selectedSenderTrusted && !selectedExternalBlocked && (
                  <button onClick={() => onTrustRemoteImages('domain')}>
                    信任 {selectedSenderDomain}
                  </button>
                )}
                <button onClick={onBlockSender}>阻止该发件人</button>
              </>
            )}

            {isTrash && (
              <>
                <span className="menu-section-title">删除</span>
                <button className="danger-menu-item" onClick={onPermanentlyDelete}>
                  <Trash2 size={16} /> 永久删除
                </button>
                <button className="danger-menu-item" onClick={onEmptyTrash}>清空废纸篓</button>
              </>
            )}
            <span className="menu-section-title">移动到</span>
            {movableFolders.map((folder) => (
              <button type="button" key={folder.id} onClick={() => onMoveToFolder(folder)}>
                {folder.name}
              </button>
            ))}
          </div>
        </details>
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
      </div>
    </header>
  );
}

export default memo(ReaderToolbar);
