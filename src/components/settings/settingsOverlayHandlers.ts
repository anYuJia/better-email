import type { SettingsSectionId } from './SettingsFrame';
import type { SetStateAction } from 'react';
import type { NotificationPolicy } from '../../mailUtils';
import type { AccountProviderPreset } from '../../providerCatalog';
import type { ProviderVerificationRecord } from '../../app/types';
import type { SettingsOverlayProps } from './SettingsOverlay';
import type { BackgroundTaskKind, Account, AccountCreateInput, Contact, ContactCreateInput, ImapMailboxState, MailIdentity, MailIdentityInput, MailRule, MailRuleInput, OutboxItem, RemoteImageTrust } from '../../app/types';
import type { RuleConditionField, SendUndoDelaySeconds } from '../../app/appConfig';
import type { ProviderWritebackValidationStepId } from '../../app/providerWriteValidation';

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
  onUpdateProviderVerification: SettingsOverlayProps['onUpdateProviderVerification'];
  onSaveProviderVerification: () => void;
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
  onCheckCredential: () => void;
  onVerifyCredential: () => void;
  onRunProviderValidation: () => void;
  onDeleteCredential: () => void;
  onStoreCredential: () => void;
  onStoreAndVerifyCredential: () => void;
  onNotificationPolicyChange: SettingsOverlayProps['onNotificationPolicyChange'];
  onSendUndoDelayChange: SettingsOverlayProps['onSendUndoDelayChange'];
  onDeleteRemoteImageTrust: SettingsOverlayProps['onDeleteRemoteImageTrust'];
  onIdentityFormChange: SettingsOverlayProps['onIdentityFormChange'];
  onEditIdentity: SettingsOverlayProps['onEditIdentity'];
  onDeleteIdentity: SettingsOverlayProps['onDeleteIdentity'];
  onSaveIdentity: () => void;
  onExportDiagnostics: () => void;
  onImportEml: () => void;
  onPreviewBackup: () => void;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onRefreshStorage: () => Promise<void>;
  onClearAttachmentCache: () => Promise<void>;
  onDiscoverImapFolders: () => void;
  onPrepareWriteValidation: SettingsOverlayProps['onPrepareWriteValidation'];
  onRefreshWriteValidation: () => void;
  onLocateWriteValidation: SettingsOverlayProps['onLocateWriteValidation'];
  onRunWritebackValidationStep: SettingsOverlayProps['onRunWritebackValidationStep'];
  onResetWritebackValidation: SettingsOverlayProps['onResetWritebackValidation'];
  onRunSyncDryRun: () => void;
  onSyncHistory: () => void;
  onMapImapMailbox: SettingsOverlayProps['onMapImapMailbox'];
  onCreateAndMapImapMailbox: SettingsOverlayProps['onCreateAndMapImapMailbox'];
  onEnqueueBackgroundTask: SettingsOverlayProps['onEnqueueBackgroundTask'];
  onCancelOutboxItem: SettingsOverlayProps['onCancelOutboxItem'];
  onContactFormChange: SettingsOverlayProps['onContactFormChange'];
  onContactFormAliasesChange: SettingsOverlayProps['onContactFormAliasesChange'];
  onContactQueryChange: SettingsOverlayProps['onContactQueryChange'];
  onCreateContact: () => void;
  onEditNameChange: SettingsOverlayProps['onEditNameChange'];
  onEditAliasesChange: SettingsOverlayProps['onEditAliasesChange'];
  onSaveContactOverride: SettingsOverlayProps['onSaveContactOverride'];
  onCancelEdit: () => void;
  onComposeToContact: SettingsOverlayProps['onComposeToContact'];
  onStartEditContact: SettingsOverlayProps['onStartEditContact'];
  onToggleContactVip: SettingsOverlayProps['onToggleContactVip'];
  onMergeContact: SettingsOverlayProps['onMergeContact'];
  onDeleteContact: SettingsOverlayProps['onDeleteContact'];
  onMergeSourceChange: SettingsOverlayProps['onMergeSourceChange'];
  onExportContacts: () => void;
  onRefreshContacts: SettingsOverlayProps['onRefreshContacts'];
  onStatus: SettingsOverlayProps['onStatus'];
  onRuleFormChange: SettingsOverlayProps['onRuleFormChange'];
  onRuleConditionFieldChange: SettingsOverlayProps['onRuleConditionFieldChange'];
  onRuleConditionValueChange: SettingsOverlayProps['onRuleConditionValueChange'];
  onRuleLabelActionChange: SettingsOverlayProps['onRuleLabelActionChange'];
  onToggleRuleAction: SettingsOverlayProps['onToggleRuleAction'];
  onSaveRule: () => void;
  onToggleRule: SettingsOverlayProps['onToggleRule'];
  onEditRule: SettingsOverlayProps['onEditRule'];
  onRemoveRule: SettingsOverlayProps['onRemoveRule'];
  onRawMessageChange: SettingsOverlayProps['onRawMessageChange'];
  onParseRawMessage: () => void;
};

type OverlayRef = { current: SettingsOverlayProps };

export function createSettingsHandlers(ref: OverlayRef): SettingsHandlers {
  const latest = (): SettingsOverlayProps => ref.current;
  return {
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
    onUpdateProviderVerification: (providerName: string, patch: Partial<ProviderVerificationRecord>) => latest().onUpdateProviderVerification(providerName, patch),
    onSaveProviderVerification: () => latest().onSaveProviderVerification(),
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
    onCheckCredential: () => latest().onCheckCredential(),
    onVerifyCredential: () => latest().onVerifyCredential(),
    onRunProviderValidation: () => latest().onRunProviderValidation(),
    onDeleteCredential: () => latest().onDeleteCredential(),
    onStoreCredential: () => latest().onStoreCredential(),
    onStoreAndVerifyCredential: () => latest().onStoreAndVerifyCredential(),
    onNotificationPolicyChange: (policy: SetStateAction<NotificationPolicy>) => latest().onNotificationPolicyChange(policy),
    onSendUndoDelayChange: (seconds: SetStateAction<SendUndoDelaySeconds>) => latest().onSendUndoDelayChange(seconds),
    onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => latest().onDeleteRemoteImageTrust(trust),
    onIdentityFormChange: (identity: SetStateAction<MailIdentityInput>) => latest().onIdentityFormChange(identity),
    onEditIdentity: (identity: MailIdentity) => latest().onEditIdentity(identity),
    onDeleteIdentity: (identity: MailIdentity) => latest().onDeleteIdentity(identity),
    onSaveIdentity: () => latest().onSaveIdentity(),
    onExportDiagnostics: () => latest().onExportDiagnostics(),
    onImportEml: () => latest().onImportEml(),
    onPreviewBackup: () => latest().onPreviewBackup(),
    onImportBackup: () => latest().onImportBackup(),
    onExportBackup: () => latest().onExportBackup(),
    onRefreshStorage: () => latest().onRefreshStorage(),
    onClearAttachmentCache: () => latest().onClearAttachmentCache(),
    onDiscoverImapFolders: () => latest().onDiscoverImapFolders(),
    onPrepareWriteValidation: () => latest().onPrepareWriteValidation(),
    onRefreshWriteValidation: () => latest().onRefreshWriteValidation(),
    onLocateWriteValidation: (role: 'sent' | 'inbox') => latest().onLocateWriteValidation(role),
    onRunWritebackValidationStep: (step: ProviderWritebackValidationStepId) => latest().onRunWritebackValidationStep(step),
    onResetWritebackValidation: () => latest().onResetWritebackValidation(),
    onRunSyncDryRun: () => latest().onRunSyncDryRun(),
    onSyncHistory: () => latest().onSyncHistory(),
    onMapImapMailbox: (mailbox: ImapMailboxState, folderId: number | null) => latest().onMapImapMailbox(mailbox, folderId),
    onCreateAndMapImapMailbox: (mailbox: ImapMailboxState) => latest().onCreateAndMapImapMailbox(mailbox),
    onEnqueueBackgroundTask: (kind: BackgroundTaskKind, source: 'manual' | 'timer') => latest().onEnqueueBackgroundTask(kind, source),
    onCancelOutboxItem: (item: OutboxItem) => latest().onCancelOutboxItem(item),
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
    onMergeContact: (contact: Contact) => latest().onMergeContact(contact),
    onDeleteContact: (contact: Contact) => latest().onDeleteContact(contact),
    onMergeSourceChange: (contactId: SetStateAction<number | null>) => latest().onMergeSourceChange(contactId),
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
    onRawMessageChange: (value: SetStateAction<string>) => latest().onRawMessageChange(value),
    onParseRawMessage: () => latest().onParseRawMessage(),
  };
}
