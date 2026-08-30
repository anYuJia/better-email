import type { SettingsSectionId } from './SettingsFrame';
import type { SetStateAction } from 'react';
import type { NotificationPolicy } from '../../mailUtils';
import type { AccountProviderPreset } from '../../providerCatalog';
import type { SettingsOverlayProps } from './SettingsOverlay';
import type { BackgroundTaskKind, Account, AccountCreateInput, Contact, ContactCreateInput, ImapMailboxState, MailIdentity, MailIdentityInput, MailRule, MailRuleInput, RemoteImageTrust } from '../../app/types';
import type { RuleConditionField, SendUndoDelaySeconds } from '../../app/appConfig';

/**
 * Stable handler wrappers for the settings workspace.
 *
 * SettingsOverlay receives ~80 props from App.tsx; many of the callbacks are
 * inline arrows that get a new identity on every App render. Wrapping them
 * through a "latest props" ref gives every page and the frame a stable
 * handler object, so memoized pages only re-render when their data props
 * actually change instead of on every application tick.
 */
export type SettingsHandlers = {
  readonly accountOptions: Array<{ id: number; label: string; email: string }>;
  readonly activeAccountId: number | null;
  onSelectAccountId: (accountId: number) => void;
  onNavigate: (section: SettingsSectionId) => void;
  onClose: () => void;
  onTestConnection: () => void;
  onSave: () => void;
  onSaveAndVerify: () => void;
  onAccountFormChange: (account: SetStateAction<Account | null>) => void;
  onSelectAccount: (account: NonNullable<SettingsOverlayProps['accountForm']>) => void;
  onNewAccountFormChange: (account: SetStateAction<AccountCreateInput>) => void;
  onApplyProviderPreset: SettingsOverlayProps['onApplyProviderPreset'];
  onApplyNewAccountPreset: SettingsOverlayProps['onApplyNewAccountPreset'];
  onCreateNewAccount: SettingsOverlayProps['onCreateNewAccount'];
  onRemoveAccount: (deleteSecret: boolean) => Promise<void>;
  onSaveAccountSettings: (updatedAccount: NonNullable<SettingsOverlayProps['accountForm']>) => Promise<void>;
  onOauthClientIdChange: (value: SetStateAction<string>) => void;
  onOauthClientSecretChange: (value: SetStateAction<string>) => void;
  onOauthRedirectUriChange: (value: SetStateAction<string>) => void;
  onOauthCallbackStateChange: (value: SetStateAction<string>) => void;
  onOauthCallbackCodeChange: (value: SetStateAction<string>) => void;
  onStartOAuth2Pkce: () => void;
  onRefreshOAuth2Token: () => void;
  onCompleteOAuth2Callback: () => void;
  onWaitForOAuth2Callback: () => void;
  onExchangeOAuth2Token: (sessionId: number) => void;
  onCredentialSecretChange: (value: SetStateAction<string>) => void;
  onVerifyCredential: () => void;
  onDeleteCredential: () => void;
  onStoreAndVerifyCredential: () => void;
  onNotificationPolicyChange: SettingsOverlayProps['onNotificationPolicyChange'];
  onSendUndoDelayChange: SettingsOverlayProps['onSendUndoDelayChange'];
  onDeleteRemoteImageTrust: SettingsOverlayProps['onDeleteRemoteImageTrust'];
  onIdentityFormChange: SettingsOverlayProps['onIdentityFormChange'];
  onEditIdentity: SettingsOverlayProps['onEditIdentity'];
  onDeleteIdentity: SettingsOverlayProps['onDeleteIdentity'];
  onSaveIdentity: () => Promise<void>;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onClearAttachmentCache: () => Promise<void>;
  onPickDownloadDir: () => void;
  onResetDownloadDir: () => void;
  onMapImapMailbox: SettingsOverlayProps['onMapImapMailbox'];
  onCreateAndMapImapMailbox: SettingsOverlayProps['onCreateAndMapImapMailbox'];
  onEnqueueBackgroundTask: SettingsOverlayProps['onEnqueueBackgroundTask'];
  onContactFormChange: SettingsOverlayProps['onContactFormChange'];
  onContactFormAliasesChange: SettingsOverlayProps['onContactFormAliasesChange'];
  onContactQueryChange: SettingsOverlayProps['onContactQueryChange'];
  onCreateContact: () => Promise<void>;
  onEditNameChange: SettingsOverlayProps['onEditNameChange'];
  onEditAliasesChange: SettingsOverlayProps['onEditAliasesChange'];
  onSaveContactOverride: SettingsOverlayProps['onSaveContactOverride'];
  onCancelEdit: () => void;
  onComposeToContact: SettingsOverlayProps['onComposeToContact'];
  onStartEditContact: SettingsOverlayProps['onStartEditContact'];
  onToggleContactVip: SettingsOverlayProps['onToggleContactVip'];
  onDeleteContact: SettingsOverlayProps['onDeleteContact'];
  onExportContacts: () => void;
  onRefreshContacts: SettingsOverlayProps['onRefreshContacts'];
  onStatus: SettingsOverlayProps['onStatus'];
  onRuleFormChange: SettingsOverlayProps['onRuleFormChange'];
  onRuleConditionFieldChange: SettingsOverlayProps['onRuleConditionFieldChange'];
  onRuleConditionValueChange: SettingsOverlayProps['onRuleConditionValueChange'];
  onRuleLabelActionChange: SettingsOverlayProps['onRuleLabelActionChange'];
  onToggleRuleAction: SettingsOverlayProps['onToggleRuleAction'];
  onSaveRule: () => Promise<void>;
  onToggleRule: SettingsOverlayProps['onToggleRule'];
  onEditRule: SettingsOverlayProps['onEditRule'];
  onRemoveRule: SettingsOverlayProps['onRemoveRule'];
};

type OverlayRef = { current: SettingsOverlayProps };

export function createSettingsHandlers(ref: OverlayRef): SettingsHandlers {
  const latest = (): SettingsOverlayProps => ref.current;
  return {
    get accountOptions() {
      return latest().accounts.map((account) => ({
        id: account.id,
        label: account.display_name || account.email,
        email: account.email,
      }));
    },
    get activeAccountId() {
      return latest().accountForm?.id ?? null;
    },
    onSelectAccountId: (accountId) => {
      const account = latest().accounts.find((candidate) => candidate.id === accountId);
      if (account) latest().onSelectAccount(account);
    },
    onNavigate: (section) => latest().onNavigate(section),
    onClose: () => latest().onClose(),
    onTestConnection: () => latest().onTestConnection(),
    onSave: () => latest().onSave(),
    onSaveAndVerify: () => latest().onSaveAndVerify?.(),
    onAccountFormChange: (account) => latest().onAccountFormChange(account),
    onSelectAccount: (account) => latest().onSelectAccount(account),
    onNewAccountFormChange: (account) => latest().onNewAccountFormChange(account),
    onApplyProviderPreset: (preset: AccountProviderPreset) => latest().onApplyProviderPreset(preset),
    onApplyNewAccountPreset: (preset: AccountProviderPreset) => latest().onApplyNewAccountPreset(preset),
    onCreateNewAccount: (secret, onProgress) => latest().onCreateNewAccount(secret, onProgress),
    onRemoveAccount: (deleteSecret) => latest().onRemoveAccount(deleteSecret),
    onSaveAccountSettings: (updatedAccount) => latest().onSaveAccountSettings(updatedAccount),
    onOauthClientIdChange: (value) => latest().onOauthClientIdChange(value),
    onOauthClientSecretChange: (value) => latest().onOauthClientSecretChange(value),
    onOauthRedirectUriChange: (value) => latest().onOauthRedirectUriChange(value),
    onOauthCallbackStateChange: (value) => latest().onOauthCallbackStateChange(value),
    onOauthCallbackCodeChange: (value) => latest().onOauthCallbackCodeChange(value),
    onStartOAuth2Pkce: () => latest().onStartOAuth2Pkce(),
    onRefreshOAuth2Token: () => latest().onRefreshOAuth2Token(),
    onCompleteOAuth2Callback: () => latest().onCompleteOAuth2Callback(),
    onWaitForOAuth2Callback: () => latest().onWaitForOAuth2Callback(),
    onExchangeOAuth2Token: (sessionId) => latest().onExchangeOAuth2Token(sessionId),
    onCredentialSecretChange: (value) => latest().onCredentialSecretChange(value),
    onVerifyCredential: () => latest().onVerifyCredential(),
    onDeleteCredential: () => latest().onDeleteCredential(),
    onStoreAndVerifyCredential: () => latest().onStoreAndVerifyCredential(),
    onNotificationPolicyChange: (policy: SetStateAction<NotificationPolicy>) => latest().onNotificationPolicyChange(policy),
    onSendUndoDelayChange: (seconds: SetStateAction<SendUndoDelaySeconds>) => latest().onSendUndoDelayChange(seconds),
    onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => latest().onDeleteRemoteImageTrust(trust),
    onIdentityFormChange: (identity: SetStateAction<MailIdentityInput>) => latest().onIdentityFormChange(identity),
    onEditIdentity: (identity: MailIdentity) => latest().onEditIdentity(identity),
    onDeleteIdentity: (identity: MailIdentity) => latest().onDeleteIdentity(identity),
    onSaveIdentity: () => latest().onSaveIdentity(),
    onImportBackup: () => latest().onImportBackup(),
    onExportBackup: () => latest().onExportBackup(),
    onClearAttachmentCache: () => latest().onClearAttachmentCache(),
    onPickDownloadDir: () => latest().onPickDownloadDir(),
    onResetDownloadDir: () => latest().onResetDownloadDir(),
    onMapImapMailbox: (mailbox: ImapMailboxState, folderId: number | null) => latest().onMapImapMailbox(mailbox, folderId),
    onCreateAndMapImapMailbox: (mailbox: ImapMailboxState) => latest().onCreateAndMapImapMailbox(mailbox),
    onEnqueueBackgroundTask: (kind: BackgroundTaskKind, source: 'manual' | 'timer') => latest().onEnqueueBackgroundTask(kind, source),
    onContactFormChange: (contact: SetStateAction<ContactCreateInput>) => latest().onContactFormChange(contact),
    onContactFormAliasesChange: (value: SetStateAction<string>) => latest().onContactFormAliasesChange(value),
    onContactQueryChange: (value: SetStateAction<string>) => latest().onContactQueryChange(value),
    onCreateContact: () => latest().onCreateContact(),
    onEditNameChange: (value: SetStateAction<string>) => latest().onEditNameChange(value),
    onEditAliasesChange: (value: SetStateAction<string>) => latest().onEditAliasesChange(value),
    onSaveContactOverride: (contact: Contact) => latest().onSaveContactOverride(contact),
    onCancelEdit: () => latest().onCancelEdit(),
    onComposeToContact: (contact: Contact) => latest().onComposeToContact(contact),
    onStartEditContact: (contact: Contact) => latest().onStartEditContact(contact),
    onToggleContactVip: (contact: Contact) => latest().onToggleContactVip(contact),
    onDeleteContact: (contact: Contact) => latest().onDeleteContact(contact),
    onExportContacts: () => latest().onExportContacts(),
    onRefreshContacts: () => latest().onRefreshContacts(),
    onStatus: (status: SetStateAction<string>) => latest().onStatus(status),
    onRuleFormChange: (rule: SetStateAction<MailRuleInput>) => latest().onRuleFormChange(rule),
    onRuleConditionFieldChange: (field: RuleConditionField) => latest().onRuleConditionFieldChange(field),
    onRuleConditionValueChange: (value: string) => latest().onRuleConditionValueChange(value),
    onRuleLabelActionChange: (label: string) => latest().onRuleLabelActionChange(label),
    onToggleRuleAction: (action: string) => latest().onToggleRuleAction(action),
    onSaveRule: () => latest().onSaveRule(),
    onToggleRule: (rule: MailRule) => latest().onToggleRule(rule),
    onEditRule: (rule: MailRule) => latest().onEditRule(rule),
    onRemoveRule: (rule: MailRule) => latest().onRemoveRule(rule),
  };
}
