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
        description="文件夹将被删除，其中的邮件会自动移回收件箱，不会丢失。"
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
        description="删除后将无法再使用该身份写信，此操作不会影响已有邮件。"
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
        description="删除后将停止自动对新邮件执行此规则。"
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
        description="将删除该联系人及其备注和别名，但与该联系人的往来邮件仍会保留。"
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
        description="删除标签后，邮件本身将被保留，仅移除此标签标记。"
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
        description="废纸篓内的邮件将被永久删除。连接异常的邮件会保留以便重试；POP3 邮件仅删除本地副本。"
        confirmText="清空废纸篓"
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
        description="所选邮件将被永久删除，无法恢复。连接异常的邮件会保留以便重试；POP3 邮件仅删除本地副本。"
        confirmText="永久删除"
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
