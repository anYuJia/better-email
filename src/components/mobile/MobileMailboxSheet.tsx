import {
  ChevronRight,
  Edit3,
  FolderOpen,
  Settings,
  UserRound,
  X,
} from 'lucide-react';
import type { Account, AccountScope, Folder } from '../../app/types';
import { folderIconForRole } from '../../app/appConfig';

type MobileMailboxSheetProps = {
  accountScope: AccountScope;
  accounts: Account[];
  folders: Folder[];
  folderId: number | null;
  onClose: () => void;
  onAccountScopeChange: (value: string) => void;
  onSelectFolder: (folderId: number) => void;
  onSetDefaultAccount: (accountId: number) => void;
  onCompose: () => void;
  onOpenSettings: () => void;
};

function folderLabel(folder: Folder): string {
  switch (folder.role) {
    case 'inbox': return '收件箱';
    case 'sent': return '已发送';
    case 'drafts': return '草稿箱';
    case 'archive': return '归档';
    case 'trash': return '废纸篓';
    case 'spam': return '垃圾邮件';
    case 'snoozed': return '稍后处理';
    default: return folder.name;
  }
}

export default function MobileMailboxSheet({
  accountScope,
  accounts,
  folders,
  folderId,
  onClose,
  onAccountScopeChange,
  onSelectFolder,
  onSetDefaultAccount,
  onCompose,
  onOpenSettings,
}: MobileMailboxSheetProps) {
  return (
    <div className="mobile-sheet-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="mobile-mailbox-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="邮箱导航"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mobile-sheet-header">
          <div>
            <span>Better Email</span>
            <strong>邮箱</strong>
          </div>
          <button type="button" className="mobile-header-icon" aria-label="关闭邮箱导航" onClick={onClose}>
            <X size={22} aria-hidden="true" />
          </button>
        </header>

        <div className="mobile-mailbox-scroll">
          <section className="mobile-mailbox-section" aria-labelledby="mobile-account-heading">
            <h2 id="mobile-account-heading">账号</h2>
            <button
              type="button"
              className={accountScope === 'all' ? 'mobile-mailbox-row active' : 'mobile-mailbox-row'}
              onClick={() => {
                onAccountScopeChange('all');
                onClose();
              }}
            >
              <span className="mobile-mailbox-row-icon"><UserRound size={19} aria-hidden="true" /></span>
              <span className="mobile-mailbox-row-copy">
                <strong>所有账号</strong>
                <small>{accounts.length ? `${accounts.length} 个账号` : '尚未添加账号'}</small>
              </span>
              {accountScope === 'all' && <span className="mobile-mailbox-check">当前</span>}
            </button>
            {accounts.map((account) => (
              <button
                type="button"
                className={accountScope === account.id ? 'mobile-mailbox-row active' : 'mobile-mailbox-row'}
                key={account.id}
                onClick={() => {
                  onAccountScopeChange(String(account.id));
                  onSetDefaultAccount(account.id);
                  onClose();
                }}
              >
                <span className="mobile-mailbox-avatar" aria-hidden="true">
                  {(account.display_name || account.email || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="mobile-mailbox-row-copy">
                  <strong>{account.display_name || account.email}</strong>
                  <small>{account.email}</small>
                </span>
                {accountScope === account.id && <span className="mobile-mailbox-check">当前</span>}
              </button>
            ))}
          </section>

          <section className="mobile-mailbox-section" aria-labelledby="mobile-folder-heading">
            <h2 id="mobile-folder-heading">文件夹</h2>
            {folders.map((folder) => (
              <button
                type="button"
                className={folder.id === folderId ? 'mobile-mailbox-row active' : 'mobile-mailbox-row'}
                key={folder.id}
                onClick={() => {
                  onSelectFolder(folder.id);
                  onClose();
                }}
              >
                <span className="mobile-mailbox-row-icon">{folderIconForRole(folder.role)}</span>
                <span className="mobile-mailbox-row-copy">
                  <strong>{folderLabel(folder)}</strong>
                  {folder.name !== folderLabel(folder) && <small>{folder.name}</small>}
                </span>
                {folder.unread_count > 0 && <span className="mobile-mailbox-count">{folder.unread_count}</span>}
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
            {folders.length === 0 && (
              <div className="mobile-mailbox-empty">
                <FolderOpen size={20} aria-hidden="true" />
                <span>暂无邮箱文件夹</span>
              </div>
            )}
          </section>
        </div>

        <footer className="mobile-mailbox-footer">
          <button type="button" onClick={onCompose}>
            <Edit3 size={19} aria-hidden="true" />
            写邮件
          </button>
          <button type="button" onClick={onOpenSettings}>
            <Settings size={19} aria-hidden="true" />
            设置
          </button>
        </footer>
      </aside>
    </div>
  );
}
