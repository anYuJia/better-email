import { Suspense, type Dispatch, type SetStateAction } from 'react';
import GlobalTooltip from './GlobalTooltip';
import ContactSyncLoadingDialog from './ContactSyncLoadingDialog';
import AppUpdateSurface from './AppUpdateSurface';
import DeferredSurface from './DeferredSurface';
import {
  ShortcutHelpModal,
  FirstRunOnboarding,
  AccountLoginDialog,
  ComposerCloseConfirmDialog,
  ConfirmationDialogs,
  UndoSnackbarStack,
  MessageToastStack,
} from '../app/lazyMailSurfaces';
import type {
  Account,
  AccountCreateInput,
  Folder,
  Label,
  MailIdentity,
  MailRule,
  Contact,
  MessageSummary,
  UndoAction,
  ComposerSaveResult,
} from '../app/types';
import type { MessageToast } from './MessageToastStack';
import type { PendingSendUndo } from './UndoSnackbarStack';
import type { ConfirmEmptyTrashState } from '../hooks/useTrashController';
import type { SendUndoDelaySeconds } from '../app/appConfig';
import type { NativePlatform } from '../hooks/useNativePlatform';

export type AppModalsProps = {
  isAccountLoginActive: boolean;
  isShortcutsOpen: boolean;
  onCloseShortcuts: () => void;
  undoAction: UndoAction | null;
  onUndoAction: () => Promise<void>;
  onDismissUndoAction: () => void;
  messageToasts: MessageToast[];
  pendingSendUndo: PendingSendUndo | null;
  onUndoSend: () => Promise<void>;
  onDismissSendUndo: () => void;
  standaloneSettingsWindow: boolean;
  nativePlatform: NativePlatform;
  nativePlatformResolved: boolean;
  isMobileApp: boolean;
  onNotifyUpdate: (text: string, tone?: MessageToast['tone']) => void;
  contactScanBusy: boolean;
  onDismissContactScan?: () => void;
  composerCloseConfirmOpen: boolean;
  setComposerCloseConfirmOpen: Dispatch<SetStateAction<boolean>>;
  onDiscardComposer: () => void;
  onSaveComposerDraft: () => Promise<ComposerSaveResult | void>;
  confirmationDialogsOpen: boolean;
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
  newAccountForm: AccountCreateInput;
  onNewAccountFormChange: Dispatch<SetStateAction<AccountCreateInput>>;
  onSubmitNewAccount: (secret: string, onProgress: (step: string) => void) => Promise<unknown>;
  pendingOnboardingAccount: Account | null;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  onOnboardingAccountPatch: (accountId: number, patch: Partial<Account>) => Promise<void>;
  onSendUndoDelayChange: (delay: SendUndoDelaySeconds) => void;
  onCompleteOnboarding: (accountId: number) => Promise<void>;
  onStatus: (status: string) => void;
};

export default function AppModals({
  isAccountLoginActive,
  isShortcutsOpen,
  onCloseShortcuts,
  undoAction,
  onUndoAction,
  onDismissUndoAction,
  messageToasts,
  pendingSendUndo,
  onUndoSend,
  onDismissSendUndo,
  standaloneSettingsWindow,
  nativePlatform,
  nativePlatformResolved,
  isMobileApp,
  onNotifyUpdate,
  contactScanBusy,
  onDismissContactScan,
  composerCloseConfirmOpen,
  setComposerCloseConfirmOpen,
  onDiscardComposer,
  onSaveComposerDraft,
  confirmationDialogsOpen,
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
  newAccountForm,
  onNewAccountFormChange,
  onSubmitNewAccount,
  pendingOnboardingAccount,
  sendUndoDelaySeconds,
  onOnboardingAccountPatch,
  onSendUndoDelayChange,
  onCompleteOnboarding,
  onStatus,
}: AppModalsProps) {
  return (
    <>
      {!isAccountLoginActive && isShortcutsOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开快捷键帮助" />}>
          <ShortcutHelpModal
            open
            onClose={onCloseShortcuts}
          />
        </Suspense>
      )}
      {!isAccountLoginActive && undoAction && (
        <Suspense fallback={null}>
          <UndoSnackbarStack
            undoAction={undoAction}
            onUndoAction={() => {
              onUndoAction().catch((error) => onStatus(String(error)));
            }}
            onDismissAction={onDismissUndoAction}
          />
        </Suspense>
      )}
      {!isAccountLoginActive && (messageToasts.length > 0 || pendingSendUndo) && (
        <Suspense fallback={null}>
          <MessageToastStack
            toasts={messageToasts}
            pendingSendUndo={pendingSendUndo}
            onUndoSend={() => {
              onUndoSend().catch((error) => onStatus(String(error)));
            }}
            onDismissSend={onDismissSendUndo}
          />
        </Suspense>
      )}
      {!isAccountLoginActive && !standaloneSettingsWindow && (
        <AppUpdateSurface
          standaloneSettingsWindow={standaloneSettingsWindow}
          nativePlatform={nativePlatform}
          nativePlatformResolved={nativePlatformResolved}
          isMobileApp={isMobileApp}
          onNotify={onNotifyUpdate}
        />
      )}
      {!isAccountLoginActive && <GlobalTooltip />}
      <ContactSyncLoadingDialog open={contactScanBusy} onDismiss={onDismissContactScan} />
      {!isAccountLoginActive && composerCloseConfirmOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开关闭写信确认" />}>
          <ComposerCloseConfirmDialog
            setOpen={setComposerCloseConfirmOpen}
            onClose={() => setComposerCloseConfirmOpen(false)}
            onDiscard={onDiscardComposer}
            onSaveDraft={onSaveComposerDraft}
          />
        </Suspense>
      )}
      {!isAccountLoginActive && confirmationDialogsOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开操作确认" />}>
          <ConfirmationDialogs
            confirmDeleteFolder={confirmDeleteFolder}
            confirmDeleteIdentity={confirmDeleteIdentity}
            confirmDeleteRule={confirmDeleteRule}
            confirmDeleteContact={confirmDeleteContact}
            confirmDeleteLabel={confirmDeleteLabel}
            confirmEmptyTrashState={confirmEmptyTrashState}
            confirmPermanentlyDelete={confirmPermanentlyDelete}
            setConfirmDeleteFolder={setConfirmDeleteFolder}
            setConfirmDeleteIdentity={setConfirmDeleteIdentity}
            setConfirmDeleteRule={setConfirmDeleteRule}
            setConfirmDeleteContact={setConfirmDeleteContact}
            setConfirmDeleteLabel={setConfirmDeleteLabel}
            setConfirmEmptyTrashState={setConfirmEmptyTrashState}
            setConfirmPermanentlyDelete={setConfirmPermanentlyDelete}
            onDeleteFolderConfirmed={onDeleteFolderConfirmed}
            onDeleteIdentityConfirmed={onDeleteIdentityConfirmed}
            onDeleteRuleConfirmed={onDeleteRuleConfirmed}
            onDeleteContactConfirmed={onDeleteContactConfirmed}
            onDeleteLabelConfirmed={onDeleteLabelConfirmed}
            onEmptyTrashConfirmed={onEmptyTrashConfirmed}
            onPermanentlyDeleteConfirmed={onPermanentlyDeleteConfirmed}
          />
        </Suspense>
      )}
      {isAccountLoginActive && (
        <Suspense fallback={<DeferredSurface label="正在准备账号登录" />}>
          <AccountLoginDialog
            form={newAccountForm}
            onFormChange={onNewAccountFormChange}
            onSubmit={onSubmitNewAccount}
          />
        </Suspense>
      )}
      {!isAccountLoginActive && pendingOnboardingAccount && (
        <Suspense fallback={<DeferredSurface label="正在准备首次设置" />}>
          <FirstRunOnboarding
            accountId={pendingOnboardingAccount.id}
            account={pendingOnboardingAccount}
            sendUndoDelaySeconds={sendUndoDelaySeconds}
            onAccountSettingsChange={(patch) => onOnboardingAccountPatch(pendingOnboardingAccount.id, patch)}
            onSendUndoDelayChange={onSendUndoDelayChange}
            onComplete={() => onCompleteOnboarding(pendingOnboardingAccount.id)}
            onSkipAll={() => onCompleteOnboarding(pendingOnboardingAccount.id)}
            onStatus={onStatus}
          />
        </Suspense>
      )}
    </>
  );
}
