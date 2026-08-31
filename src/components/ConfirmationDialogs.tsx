import type { Dispatch, SetStateAction } from 'react';
import type {
  Contact,
  Folder,
  Label,
  MailIdentity,
  MailRule,
  MessageSummary,
} from '../app/types';
import ConfirmDialog from './ConfirmDialog';
import type { ConfirmEmptyTrashState } from '../hooks/useTrashController';

type ConfirmationDialogsProps = {
  confirmDeleteFolder: Folder | null;
  confirmDeleteIdentity: MailIdentity | null;
  confirmDeleteRule: MailRule | null;
  confirmDeleteContact: Contact | null;
  confirmDeleteLabel: Label | null;
  confirmEmptyTrashState: ConfirmEmptyTrashState | null;
  confirmPermanentlyDelete: MessageSummary[] | null;
  setConfirmDeleteFolder: Dispatch<SetStateAction<Folder | null>>;
  setConfirmDeleteIdentity: Dispatch<SetStateAction<MailIdentity | null>>;
  setConfirmDeleteRule: Dispatch<SetStateAction<MailRule | null>>;
  setConfirmDeleteContact: Dispatch<SetStateAction<Contact | null>>;
  setConfirmDeleteLabel: Dispatch<SetStateAction<Label | null>>;
  setConfirmEmptyTrashState: Dispatch<SetStateAction<ConfirmEmptyTrashState | null>>;
  setConfirmPermanentlyDelete: Dispatch<SetStateAction<MessageSummary[] | null>>;
  onDeleteFolderConfirmed: (folder: Folder) => Promise<void>;
  onDeleteIdentityConfirmed: (identity: MailIdentity) => Promise<void>;
  onDeleteRuleConfirmed: (rule: MailRule) => Promise<void>;
  onDeleteContactConfirmed: (contact: Contact) => Promise<void>;
  onDeleteLabelConfirmed: (labelId: number) => Promise<void>;
  onEmptyTrashConfirmed: (accountId: number) => Promise<void>;
  onPermanentlyDeleteConfirmed: (messages: MessageSummary[]) => Promise<void>;
};

export default function ConfirmationDialogs({
  confirmDeleteFolder,
  confirmDeleteIdentity,
  confirmDeleteRule,
  confirmDeleteContact,
  confirmDeleteLabel,
  confirmEmptyTrashState,
  confirmPermanentlyDelete,
  setConfirmDeleteFolder,
  setConfirmDeleteIdentity,
  setConfirmDeleteRule,
  setConfirmDeleteContact,
  setConfirmDeleteLabel,
  setConfirmEmptyTrashState,
  setConfirmPermanentlyDelete,
  onDeleteFolderConfirmed,
  onDeleteIdentityConfirmed,
  onDeleteRuleConfirmed,
  onDeleteContactConfirmed,
  onDeleteLabelConfirmed,
  onEmptyTrashConfirmed,
  onPermanentlyDeleteConfirmed,
}: ConfirmationDialogsProps) {
  return (
    <>
      <ConfirmDialog
        open={!!confirmDeleteFolder}
        title="删除文件夹"
        summaryText={confirmDeleteFolder ? `确认删除自定义文件夹 "${confirmDeleteFolder.name}" 吗？` : ''}
        description="该操作不可逆。删除后文件夹内的邮件将被移回到收件箱中，以便保留邮件。"
        onConfirm={async () => {
          if (confirmDeleteFolder) {
            await onDeleteFolderConfirmed(confirmDeleteFolder);
          }
          setConfirmDeleteFolder(null);
        }}
        onCancel={() => setConfirmDeleteFolder(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteIdentity}
        title="删除发件身份"
        summaryText={confirmDeleteIdentity ? `确认删除身份 "${confirmDeleteIdentity.name} <${confirmDeleteIdentity.email}>" 吗？` : ''}
        description="该操作不可逆。删除身份后您将不能再使用此身份写信，但不会删除该邮箱账号下的任何邮件。"
        onConfirm={async () => {
          if (confirmDeleteIdentity) {
            await onDeleteIdentityConfirmed(confirmDeleteIdentity);
          }
          setConfirmDeleteIdentity(null);
        }}
        onCancel={() => setConfirmDeleteIdentity(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteRule}
        title="删除规则"
        summaryText={confirmDeleteRule ? `确认删除邮件规则 "${confirmDeleteRule.name}" 吗？` : ''}
        description="该操作不可逆。删除后将不会再自动对新邮件执行此规则对应的分类动作。"
        onConfirm={async () => {
          if (confirmDeleteRule) {
            await onDeleteRuleConfirmed(confirmDeleteRule);
          }
          setConfirmDeleteRule(null);
        }}
        onCancel={() => setConfirmDeleteRule(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteContact}
        title="删除联系人"
        summaryText={confirmDeleteContact ? `确认删除联系人 "${confirmDeleteContact.name || confirmDeleteContact.email}" 吗？` : ''}
        description="该操作不可逆。删除此联系人不会删除与该发件人的往来邮件，但会删除该联系人的备注、别名等数据。"
        onConfirm={async () => {
          if (confirmDeleteContact) {
            await onDeleteContactConfirmed(confirmDeleteContact);
          }
          setConfirmDeleteContact(null);
        }}
        onCancel={() => setConfirmDeleteContact(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteLabel}
        title="删除标签"
        summaryText={confirmDeleteLabel ? `确认删除标签 "${confirmDeleteLabel.name}" 吗？` : ''}
        description="该操作不可逆。删除该标签后，所有已归类到此标签的邮件将不再显示该标签标记，但邮件正文及其他分类属性仍会完整保留。"
        onConfirm={async () => {
          if (confirmDeleteLabel) {
            await onDeleteLabelConfirmed(confirmDeleteLabel.id);
          }
          setConfirmDeleteLabel(null);
        }}
        onCancel={() => setConfirmDeleteLabel(null)}
      />
      <ConfirmDialog
        open={!!confirmEmptyTrashState}
        title="清空废纸篓"
        summaryText={confirmEmptyTrashState ? `确认要清空账号 "${confirmEmptyTrashState.accountName}" 的废纸篓吗？` : '确认要清空当前账号的废纸篓吗？'}
        description="此操作不可逆。废纸篓中所有已删除的邮件都将被永久从本地和服务器上删除，无法恢复。"
        onConfirm={async () => {
          if (confirmEmptyTrashState) {
            await onEmptyTrashConfirmed(confirmEmptyTrashState.accountId);
          }
          setConfirmEmptyTrashState(null);
        }}
        onCancel={() => setConfirmEmptyTrashState(null)}
      />
      <ConfirmDialog
        open={!!confirmPermanentlyDelete}
        title={confirmPermanentlyDelete && confirmPermanentlyDelete.length > 1 ? '永久删除多封邮件' : '永久删除邮件'}
        summaryText={confirmPermanentlyDelete
          ? confirmPermanentlyDelete.length > 1
            ? `确认要永久删除选中的 ${confirmPermanentlyDelete.length} 封邮件吗？`
            : `确认要永久删除邮件 "${confirmPermanentlyDelete[0]?.subject || '(无主题)'}" 吗？`
          : '确认要永久删除选中的邮件吗？'}
        description="此操作不可逆。邮件将被直接从服务器及本地存储中彻底抹去，无法从废纸篓找回。"
        onConfirm={async () => {
          if (confirmPermanentlyDelete) {
            await onPermanentlyDeleteConfirmed(confirmPermanentlyDelete);
          }
          setConfirmPermanentlyDelete(null);
        }}
        onCancel={() => setConfirmPermanentlyDelete(null)}
      />
    </>
  );
}
