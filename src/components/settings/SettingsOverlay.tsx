import React, { Suspense, lazy, type Dispatch, type SetStateAction } from 'react';
import type {
  Account,
  AccountCreateInput,
  BackgroundTaskKind,
  Contact,
  ContactCreateInput,
  ContactMergeSuggestion,
  ConnectionReport,
  CredentialStatus,
  CredentialVerificationReport,
  Folder,
  ImapMailboxState,
  ImapProbeReport,
  Label,
  LocalBackupSummary,
  MailIdentity,
  MailIdentityInput,
  MailRule,
  MailRuleInput,
  OAuthCallbackReport,
  OAuthRefreshReport,
  OAuthSession,
  OAuthStartReport,
  OAuthTokenExchangeReport,
  OutboxItem,
  ParsedMessagePreview,
  ProviderVerificationRecord,
  RemoteImageTrust,
  StorageUsage,
  SyncRun,
  SyncSchedulePlan,
} from '../../app/types';
import type {
  RuleConditionField,
  SendUndoDelaySeconds,
} from '../../app/appConfig';
import type { AccountProviderPreset } from '../../providerCatalog';
import type { ProviderValidationReport } from '../../app/providerValidation';
import type { SaveAndVerifyReport } from '../../app/accountConnectionSettings';
import type {
  ProviderWritebackValidationProgress,
  ProviderWritebackValidationStepId,
  ProviderWriteValidationStatus,
} from '../../app/providerWriteValidation';
import type { NotificationPolicy } from '../../mailUtils';
import type { SettingsSectionId } from './SettingsFrame';
import DeferredSurface from '../DeferredSurface';
import SettingsFrame from './SettingsFrame';
import { invoke } from '../../tauriBridge';

const AccountConnectionSettings = lazy(() => import('./AccountConnectionSettings'));
const CredentialSecuritySettings = lazy(() => import('./CredentialSecuritySettings'));
const ExperienceSettings = lazy(() => import('./ExperienceSettings'));
const DataSafetySettings = lazy(() => import('./DataSafetySettings'));
const SyncOperationsSettings = lazy(() => import('./SyncOperationsSettings'));
const ContactAutomationSettings = lazy(() => import('./ContactAutomationSettings'));
const RuleAutomationSettings = lazy(() => import('./RuleAutomationSettings'));
const SecurityPreviewSettings = lazy(() => import('./SecurityPreviewSettings'));
const AiServiceSettings = lazy(() => import('./AiServiceSettings'));
const TemplateSettings = lazy(() => import('./TemplateSettings'));

type SettingsOverlayProps = {
  accountForm: Account | null;
  accounts: Account[];
  newAccountForm: AccountCreateInput;
  activeSettingsSection: SettingsSectionId;
  accountSettingsDirty: boolean;
  accountSettingsSaving: boolean;
  saveAndVerifyRunning: boolean;
  saveAndVerifyReport: SaveAndVerifyReport;
  providerVerifications: Record<string, ProviderVerificationRecord>;
  activeProviderVerification: ProviderVerificationRecord | null;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRedirectUri: string;
  oauthCallbackState: string;
  oauthCallbackCode: string;
  oauthReport: OAuthStartReport | null;
  oauthCallbackReport: OAuthCallbackReport | null;
  oauthExchangeReport: OAuthTokenExchangeReport | null;
  oauthRefreshReport: OAuthRefreshReport | null;
  oauthSessions: OAuthSession[];
  authTypeChanged: boolean;
  authTypeChangeNotice: string | null;
  connectionReport: ConnectionReport | null;
  credentialVerification: CredentialVerificationReport | null;
  providerValidationReport: ProviderValidationReport | null;
  providerValidationRunning: boolean;
  credentialSecret: string;
  credentialStatus: CredentialStatus | null;
  notificationPolicy: NotificationPolicy;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  remoteImageTrusts: RemoteImageTrust[];
  identities: MailIdentity[];
  identityForm: MailIdentityInput;
  diagnosticExport: string | null;
  localBackupSummary: LocalBackupSummary | null;
  storageUsage: StorageUsage | null;
  storageBusy: boolean;
  imapProbe: ImapProbeReport | null;
  syncSchedulePlan: SyncSchedulePlan | null;
  imapMailboxes: ImapMailboxState[];
  folders: Folder[];
  syncRuns: SyncRun[];
  outbox: OutboxItem[];
  labels: Label[];
  rules: MailRule[];
  ruleForm: MailRuleInput;
  ruleBuilderField: RuleConditionField;
  ruleBuilderNeedle: string;
  editingRuleId: number | null;
  rawMessage: string;
  parsedPreview: ParsedMessagePreview | null;
  mergeSuggestions: ContactMergeSuggestion[];
  contactForm: ContactCreateInput;
  contactFormAliases: string;
  contacts: Contact[];
  editingContactId: number | null;
  contactEditName: string;
  contactEditAliases: string;
  mergeSourceContactId: number | null;
  contactTransferBusy: boolean;
  providerWriteValidationStatus: ProviderWriteValidationStatus | null;
  providerWriteValidationLoading: boolean;
  providerWritebackValidationProgress: ProviderWritebackValidationProgress | null;
  setStatus: Dispatch<SetStateAction<string>>;
  onNavigate: (section: SettingsSectionId) => void;
  onClose: () => void;
  onTestConnection: () => void;
  onSave: () => void;
  onSaveAndVerify: (() => void) | undefined;
  onAccountFormChange: Dispatch<SetStateAction<Account | null>>;
  onNewAccountFormChange: Dispatch<SetStateAction<AccountCreateInput>>;
  onApplyProviderPreset: (preset: AccountProviderPreset) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: (secret?: string) => Promise<void>;
  onRemoveAccount: (deleteSecret: boolean) => Promise<void>;
  onUpdateProviderVerification: (
    providerName: string,
    patch: Partial<ProviderVerificationRecord>,
  ) => void;
  onSaveProviderVerification: () => void;
  onSaveAccountSettings: (updatedAccount: Account) => Promise<void>;
  onOauthClientIdChange: Dispatch<SetStateAction<string>>;
  onOauthClientSecretChange: Dispatch<SetStateAction<string>>;
  onOauthRedirectUriChange: Dispatch<SetStateAction<string>>;
  onOauthCallbackStateChange: Dispatch<SetStateAction<string>>;
  onOauthCallbackCodeChange: Dispatch<SetStateAction<string>>;
  onStartOAuth2Pkce: () => void;
  onRefreshOAuth2Token: () => void;
  onCompleteOAuth2Callback: () => void;
  onWaitForOAuth2Callback: () => void;
  onExchangeOAuth2Token: (sessionId: number) => void;
  onCredentialSecretChange: Dispatch<SetStateAction<string>>;
  onCheckCredential: () => void;
  onVerifyCredential: () => void;
  onRunProviderValidation: () => void;
  onDeleteCredential: () => void;
  onStoreCredential: () => void;
  onStoreAndVerifyCredential: () => void;
  onNotificationPolicyChange: Dispatch<SetStateAction<NotificationPolicy>>;
  onSendUndoDelayChange: Dispatch<SetStateAction<SendUndoDelaySeconds>>;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
  onIdentityFormChange: Dispatch<SetStateAction<MailIdentityInput>>;
  onEditIdentity: (identity: MailIdentity) => void;
  onDeleteIdentity: (identity: MailIdentity) => void;
  onSaveIdentity: () => void;
  onExportDiagnostics: () => void;
  onImportEml: () => void;
  onPreviewBackup: () => void;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onRefreshStorage: () => Promise<void>;
  onClearAttachmentCache: () => Promise<void>;
  onDiscoverImapFolders: () => void;
  onPrepareWriteValidation: () => void;
  onRefreshWriteValidation: () => void;
  onLocateWriteValidation: (role: 'sent' | 'inbox') => void;
  onRunWritebackValidationStep: (step: ProviderWritebackValidationStepId) => void;
  onResetWritebackValidation: () => void;
  onRunSyncDryRun: () => void;
  onSyncHistory: () => void;
  onMapImapMailbox: (mailbox: ImapMailboxState, folderId: number | null) => void;
  onCreateAndMapImapMailbox: (mailbox: ImapMailboxState) => void;
  onEnqueueBackgroundTask: (kind: BackgroundTaskKind, source: 'manual' | 'timer') => void;
  onCancelOutboxItem: (item: OutboxItem) => void;
  onContactFormChange: Dispatch<SetStateAction<ContactCreateInput>>;
  onContactFormAliasesChange: Dispatch<SetStateAction<string>>;
  onCreateContact: () => void;
  onMergeSuggested: (suggestion: ContactMergeSuggestion) => void;
  onEditNameChange: Dispatch<SetStateAction<string>>;
  onEditAliasesChange: Dispatch<SetStateAction<string>>;
  onSaveContactOverride: (contact: Contact) => void;
  onCancelEdit: () => void;
  onComposeToContact: (contact: Contact) => void;
  onStartEditContact: (contact: Contact) => void;
  onToggleContactVip: (contact: Contact) => void;
  onMergeContact: (contact: Contact) => void;
  onDeleteContact: (contact: Contact) => void;
  onMergeSourceChange: Dispatch<SetStateAction<number | null>>;
  onImportContacts: () => void;
  onExportContacts: () => void;
  onRefreshContacts: () => Promise<Contact[]>;
  onStatus: Dispatch<SetStateAction<string>>;
  onRuleFormChange: Dispatch<SetStateAction<MailRuleInput>>;
  onRuleConditionFieldChange: (field: RuleConditionField) => void;
  onRuleConditionValueChange: (value: string) => void;
  onRuleLabelActionChange: (labelName: string) => void;
  onToggleRuleAction: (action: string) => void;
  onSaveRule: () => void;
  onToggleRule: (rule: MailRule) => void;
  onEditRule: (rule: MailRule) => void;
  onRemoveRule: (rule: MailRule) => void;
  onRawMessageChange: Dispatch<SetStateAction<string>>;
  onParseRawMessage: () => void;
};

export default function SettingsOverlay({
  accountForm,
  accounts,
  newAccountForm,
  activeSettingsSection,
  accountSettingsDirty,
  accountSettingsSaving,
  saveAndVerifyRunning,
  saveAndVerifyReport,
  providerVerifications,
  activeProviderVerification,
  oauthClientId,
  oauthClientSecret,
  oauthRedirectUri,
  oauthCallbackState,
  oauthCallbackCode,
  oauthReport,
  oauthCallbackReport,
  oauthExchangeReport,
  oauthRefreshReport,
  oauthSessions,
  authTypeChanged,
  authTypeChangeNotice,
  connectionReport,
  credentialVerification,
  providerValidationReport,
  providerValidationRunning,
  credentialSecret,
  credentialStatus,
  notificationPolicy,
  sendUndoDelaySeconds,
  remoteImageTrusts,
  identities,
  identityForm,
  diagnosticExport,
  localBackupSummary,
  storageUsage,
  storageBusy,
  imapProbe,
  syncSchedulePlan,
  imapMailboxes,
  folders,
  syncRuns,
  outbox,
  labels,
  rules,
  ruleForm,
  ruleBuilderField,
  ruleBuilderNeedle,
  editingRuleId,
  rawMessage,
  parsedPreview,
  mergeSuggestions,
  contactForm,
  contactFormAliases,
  contacts,
  editingContactId,
  contactEditName,
  contactEditAliases,
  mergeSourceContactId,
  contactTransferBusy,
  providerWriteValidationStatus,
  providerWriteValidationLoading,
  providerWritebackValidationProgress,
  setStatus,
  onNavigate,
  onClose,
  onTestConnection,
  onSave,
  onSaveAndVerify,
  onAccountFormChange,
  onNewAccountFormChange,
  onApplyProviderPreset,
  onApplyNewAccountPreset,
  onCreateNewAccount,
  onRemoveAccount,
  onUpdateProviderVerification,
  onSaveProviderVerification,
  onSaveAccountSettings,
  onOauthClientIdChange,
  onOauthClientSecretChange,
  onOauthRedirectUriChange,
  onOauthCallbackStateChange,
  onOauthCallbackCodeChange,
  onStartOAuth2Pkce,
  onRefreshOAuth2Token,
  onCompleteOAuth2Callback,
  onWaitForOAuth2Callback,
  onExchangeOAuth2Token,
  onCredentialSecretChange,
  onCheckCredential,
  onVerifyCredential,
  onRunProviderValidation,
  onDeleteCredential,
  onStoreCredential,
  onStoreAndVerifyCredential,
  onNotificationPolicyChange,
  onSendUndoDelayChange,
  onDeleteRemoteImageTrust,
  onIdentityFormChange,
  onEditIdentity,
  onDeleteIdentity,
  onSaveIdentity,
  onExportDiagnostics,
  onImportEml,
  onPreviewBackup,
  onImportBackup,
  onExportBackup,
  onRefreshStorage,
  onClearAttachmentCache,
  onDiscoverImapFolders,
  onPrepareWriteValidation,
  onRefreshWriteValidation,
  onLocateWriteValidation,
  onRunWritebackValidationStep,
  onResetWritebackValidation,
  onRunSyncDryRun,
  onSyncHistory,
  onMapImapMailbox,
  onCreateAndMapImapMailbox,
  onEnqueueBackgroundTask,
  onCancelOutboxItem,
  onContactFormChange,
  onContactFormAliasesChange,
  onCreateContact,
  onMergeSuggested,
  onEditNameChange,
  onEditAliasesChange,
  onSaveContactOverride,
  onCancelEdit,
  onComposeToContact,
  onStartEditContact,
  onToggleContactVip,
  onMergeContact,
  onDeleteContact,
  onMergeSourceChange,
  onImportContacts,
  onExportContacts,
  onRefreshContacts,
  onStatus,
  onRuleFormChange,
  onRuleConditionFieldChange,
  onRuleConditionValueChange,
  onRuleLabelActionChange,
  onToggleRuleAction,
  onSaveRule,
  onToggleRule,
  onEditRule,
  onRemoveRule,
  onRawMessageChange,
  onParseRawMessage,
}: SettingsOverlayProps) {
  return (
    <Suspense fallback={<DeferredSurface label="正在打开设置" />}>
      <SettingsFrame
        title="设置"
        subtitle={accountForm ? `${accountForm.email} · ${accountForm.provider}` : '未添加账号'}
        activeSection={activeSettingsSection}
        onNavigate={onNavigate}
        onTestConnection={onTestConnection}
        isDirty={accountSettingsDirty}
        isBusy={accountSettingsSaving || saveAndVerifyRunning}
        connectionSummary={saveAndVerifyReport.summary}
        onSave={onSave}
        onSaveAndVerify={onSaveAndVerify}
        onClose={onClose}
      >
        <Suspense fallback={<div className="settings-page-loading" role="status">正在加载设置页面…</div>}>
        {(activeSettingsSection === 'accounts'
          || activeSettingsSection === 'providers'
          || activeSettingsSection === 'auth') && (
        <>
        <AccountConnectionSettings
          section={activeSettingsSection}
          accounts={accounts}
          accountForm={accountForm}
          accountCount={accounts.length}
          newAccountForm={newAccountForm}
          providerVerifications={providerVerifications}
          activeProviderVerification={activeProviderVerification}
          oauthClientId={oauthClientId}
          oauthClientSecret={oauthClientSecret}
          oauthRedirectUri={oauthRedirectUri}
          oauthCallbackState={oauthCallbackState}
          oauthCallbackCode={oauthCallbackCode}
          oauthReport={oauthReport}
          oauthCallbackReport={oauthCallbackReport}
          oauthExchangeReport={oauthExchangeReport}
          oauthRefreshReport={oauthRefreshReport}
          oauthSessions={oauthSessions}
          authTypeChanged={authTypeChanged}
          authTypeChangeNotice={authTypeChangeNotice}
          saveAndVerifyReport={saveAndVerifyReport}
          onAccountFormChange={onAccountFormChange}
          onNewAccountFormChange={onNewAccountFormChange}
          onApplyProviderPreset={onApplyProviderPreset}
          onApplyNewAccountPreset={onApplyNewAccountPreset}
          onCreateNewAccount={onCreateNewAccount}
          onRemoveAccount={onRemoveAccount}
          onUpdateProviderVerification={onUpdateProviderVerification}
          onSaveProviderVerification={onSaveProviderVerification}
          onSaveAccountSettings={onSaveAccountSettings}
          onOauthClientIdChange={onOauthClientIdChange}
          onOauthClientSecretChange={onOauthClientSecretChange}
          onOauthRedirectUriChange={onOauthRedirectUriChange}
          onOauthCallbackStateChange={onOauthCallbackStateChange}
          onOauthCallbackCodeChange={onOauthCallbackCodeChange}
          onStartOAuth2Pkce={onStartOAuth2Pkce}
          onRefreshOAuth2Token={onRefreshOAuth2Token}
          onCompleteOAuth2Callback={onCompleteOAuth2Callback}
          onWaitForOAuth2Callback={onWaitForOAuth2Callback}
          onExchangeOAuth2Token={onExchangeOAuth2Token}
        />
        {activeSettingsSection === 'auth' && accountForm && (
          <CredentialSecuritySettings
            account={accountForm}
            credentialSecret={credentialSecret}
            credentialStatus={credentialStatus}
            connectionReport={connectionReport?.account_email === accountForm.email ? connectionReport : null}
            credentialVerification={
              !authTypeChanged && credentialVerification?.account_email === accountForm.email
                ? credentialVerification
                : null
            }
            authTypeChangeNotice={authTypeChangeNotice}
            providerValidationReport={
              providerValidationReport?.account_email === accountForm.email ? providerValidationReport : null
            }
            providerValidationRunning={
              providerValidationRunning && providerValidationReport?.account_email === accountForm.email
            }
            onCredentialSecretChange={onCredentialSecretChange}
            onCheckCredential={onCheckCredential}
            onVerifyCredential={onVerifyCredential}
            onRunProviderValidation={onRunProviderValidation}
            onDeleteCredential={onDeleteCredential}
            onStoreCredential={onStoreCredential}
            onStoreAndVerifyCredential={onStoreAndVerifyCredential}
          />
        )}
        </>
        )}
        {(activeSettingsSection === 'sending'
          || activeSettingsSection === 'notifications'
          || activeSettingsSection === 'privacy'
          || activeSettingsSection === 'identities') && accountForm && (
        <ExperienceSettings
          section={activeSettingsSection}
          accountForm={accountForm}
          accounts={accounts}
          notificationPolicy={notificationPolicy}
          sendUndoDelaySeconds={sendUndoDelaySeconds}
          remoteImageTrusts={remoteImageTrusts}
          identities={identities}
          identityForm={identityForm}
          onAccountFormChange={onAccountFormChange}
          onNotificationPolicyChange={onNotificationPolicyChange}
          onSendUndoDelayChange={onSendUndoDelayChange}
          onDeleteRemoteImageTrust={onDeleteRemoteImageTrust}
          onIdentityFormChange={onIdentityFormChange}
          onEditIdentity={onEditIdentity}
          onDeleteIdentity={onDeleteIdentity}
          onSaveIdentity={onSaveIdentity}
          onNavigateToAi={() => onNavigate('ai')}
        />
        )}
        {activeSettingsSection === 'backup' && (
        <DataSafetySettings
          diagnosticExport={diagnosticExport}
          localBackupSummary={localBackupSummary}
          connectionReport={connectionReport}
          storageUsage={storageUsage}
          storageBusy={storageBusy}
          onExportDiagnostics={onExportDiagnostics}
          onImportEml={onImportEml}
          onPreviewBackup={onPreviewBackup}
          onImportBackup={onImportBackup}
          onExportBackup={onExportBackup}
          onRefreshStorage={onRefreshStorage}
          onClearAttachmentCache={onClearAttachmentCache}
        />
        )}
        {activeSettingsSection === 'sync' && accountForm && (
        <SyncOperationsSettings
          accountForm={accountForm}
          imapProbe={imapProbe}
          syncSchedulePlan={syncSchedulePlan}
          imapMailboxes={imapMailboxes}
          folders={folders}
          syncRuns={syncRuns}
          outbox={outbox}
          writeValidationStatus={providerWriteValidationStatus}
          writeValidationLoading={providerWriteValidationLoading}
          writebackValidationProgress={providerWritebackValidationProgress}
          onDiscoverImapFolders={onDiscoverImapFolders}
          onPrepareWriteValidation={onPrepareWriteValidation}
          onRefreshWriteValidation={onRefreshWriteValidation}
          onLocateWriteValidation={onLocateWriteValidation}
          onRunWritebackValidationStep={onRunWritebackValidationStep}
          onResetWritebackValidation={onResetWritebackValidation}
          onRunSyncDryRun={onRunSyncDryRun}
          onSyncHistory={onSyncHistory}
          onMapImapMailbox={onMapImapMailbox}
          onCreateAndMapImapMailbox={onCreateAndMapImapMailbox}
          onEnqueueBackgroundTask={onEnqueueBackgroundTask}
          onCancelOutboxItem={onCancelOutboxItem}
        />
        )}
        {activeSettingsSection === 'contacts' && (
        <ContactAutomationSettings
          mergeSuggestions={mergeSuggestions}
          contactForm={contactForm}
          contactFormAliases={contactFormAliases}
          contacts={contacts}
          editingContactId={editingContactId}
          editName={contactEditName}
          editAliases={contactEditAliases}
          mergeSourceContactId={mergeSourceContactId}
          transferBusy={contactTransferBusy}
          onContactFormChange={onContactFormChange}
          onContactFormAliasesChange={onContactFormAliasesChange}
          onCreateContact={onCreateContact}
          onMergeSuggested={onMergeSuggested}
          onEditNameChange={onEditNameChange}
          onEditAliasesChange={onEditAliasesChange}
          onSaveContactOverride={onSaveContactOverride}
          onCancelEdit={onCancelEdit}
          onComposeToContact={onComposeToContact}
          onStartEditContact={onStartEditContact}
          onToggleContactVip={onToggleContactVip}
          onMergeContact={onMergeContact}
          onDeleteContact={onDeleteContact}
          onMergeSourceChange={onMergeSourceChange}
          onImportContacts={onImportContacts}
          onExportContacts={onExportContacts}
          onRefreshContacts={onRefreshContacts}
          onStatus={onStatus}
        />
        )}
        {activeSettingsSection === 'rules' && (
        <RuleAutomationSettings
          ruleForm={ruleForm}
          ruleBuilderField={ruleBuilderField}
          ruleBuilderNeedle={ruleBuilderNeedle}
          editingRuleId={editingRuleId}
          rules={rules}
          labels={labels}
          onRuleFormChange={onRuleFormChange}
          onRuleConditionFieldChange={onRuleConditionFieldChange}
          onRuleConditionValueChange={onRuleConditionValueChange}
          onRuleLabelActionChange={onRuleLabelActionChange}
          onToggleRuleAction={onToggleRuleAction}
          onSaveRule={onSaveRule}
          onToggleRule={onToggleRule}
          onEditRule={onEditRule}
          onRemoveRule={onRemoveRule}
        />
        )}
        {activeSettingsSection === 'security-preview' && (
        <SecurityPreviewSettings
          rawMessage={rawMessage}
          parsedPreview={parsedPreview}
          onRawMessageChange={onRawMessageChange}
          onParseRawMessage={onParseRawMessage}
        />
        )}
        {activeSettingsSection === 'ai' && (
        <AiServiceSettings />
        )}
        {activeSettingsSection === 'templates' && (
        <TemplateSettings onNavigateToAi={() => onNavigate('ai')} />
        )}
        </Suspense>
      </SettingsFrame>
    </Suspense>
  );
}
