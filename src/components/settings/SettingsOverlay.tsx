import {
  Suspense,
  lazy,
  memo,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  Account,
  AccountCreateInput,
  BackgroundTaskKind,
  Contact,
  ContactCreateInput,
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
import type { ThemeMode } from '../../hooks/useThemeMode';
import type { SettingsSectionId } from './SettingsFrame';
import DeferredSurface from '../DeferredSurface';
import SettingsFrame from './SettingsFrame';
import { createSettingsHandlers } from './settingsOverlayHandlers';

const AccountConnectionSettings = lazy(() => import('./AccountConnectionSettings'));
const CredentialSecuritySettings = lazy(() => import('./CredentialSecuritySettings'));
const ExperienceSettings = lazy(() => import('./ExperienceSettings'));
const AppearanceSettings = lazy(() => import('./AppearanceSettings'));
const DataSafetySettings = lazy(() => import('./DataSafetySettings'));
const SyncOperationsSettings = lazy(() => import('./SyncOperationsSettings'));
const ContactAutomationSettings = lazy(() => import('./ContactAutomationSettings'));
const RuleAutomationSettings = lazy(() => import('./RuleAutomationSettings'));
const SecurityPreviewSettings = lazy(() => import('./SecurityPreviewSettings'));
const AiServiceSettings = lazy(() => import('./AiServiceSettings'));
const TemplateSettings = lazy(() => import('./TemplateSettings'));

export type SettingsOverlayProps = {
  accountForm: Account | null;
  accounts: Account[];
  newAccountForm: AccountCreateInput;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
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
  outbox: OutboxItem[];
  labels: Label[];
  rules: MailRule[];
  ruleForm: MailRuleInput;
  ruleBuilderField: RuleConditionField;
  ruleBuilderNeedle: string;
  editingRuleId: number | null;
  rawMessage: string;
  parsedPreview: ParsedMessagePreview | null;
  contactForm: ContactCreateInput;
  contactFormAliases: string;
  contacts: Contact[];
  editingContactId: number | null;
  contactEditName: string;
  contactEditAliases: string;
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
  onSelectAccount: (account: Account) => void;
  onNewAccountFormChange: Dispatch<SetStateAction<AccountCreateInput>>;
  onApplyProviderPreset: (preset: AccountProviderPreset) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: (secret?: string, onProgress?: (stage: string) => void) => Promise<void>;
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
  onSaveIdentity: () => Promise<void>;
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
  filteredContacts: Contact[];
  contactQuery: string;
  onContactQueryChange: Dispatch<SetStateAction<string>>;
  onCreateContact: () => Promise<void>;
  onEditNameChange: Dispatch<SetStateAction<string>>;
  onEditAliasesChange: Dispatch<SetStateAction<string>>;
  onSaveContactOverride: (contact: Contact) => void | Promise<void>;
  onCancelEdit: () => void;
  onComposeToContact: (contact: Contact) => void;
  onStartEditContact: (contact: Contact) => void;
  onToggleContactVip: (contact: Contact) => void;
  onDeleteContact: (contact: Contact) => void;
  onExportContacts: () => void;
  onRefreshContacts: () => Promise<Contact[]>;
  onStatus: Dispatch<SetStateAction<string>>;
  onRuleFormChange: Dispatch<SetStateAction<MailRuleInput>>;
  onRuleConditionFieldChange: (field: RuleConditionField) => void;
  onRuleConditionValueChange: (value: string) => void;
  onRuleLabelActionChange: (labelName: string) => void;
  onToggleRuleAction: (action: string) => void;
  onSaveRule: () => Promise<void>;
  onToggleRule: (rule: MailRule) => void;
  onEditRule: (rule: MailRule) => void;
  onRemoveRule: (rule: MailRule) => void;
  onRawMessageChange: Dispatch<SetStateAction<string>>;
  onParseRawMessage: () => void;
};

const MemoizedAccountConnection = memo(AccountConnectionSettings);
const MemoizedCredentialSecurity = memo(CredentialSecuritySettings);
const MemoizedExperience = memo(ExperienceSettings);
const MemoizedAppearance = memo(AppearanceSettings);
const MemoizedDataSafety = memo(DataSafetySettings);
const MemoizedSyncOperations = memo(SyncOperationsSettings);
const MemoizedContactAutomation = memo(ContactAutomationSettings);
const MemoizedRuleAutomation = memo(RuleAutomationSettings);
const MemoizedSecurityPreview = memo(SecurityPreviewSettings);
const MemoizedAiService = memo(AiServiceSettings);
const MemoizedTemplates = memo(TemplateSettings);

export default function SettingsOverlay(props: SettingsOverlayProps) {
  const {
    accountForm,
    activeSettingsSection,
    accountSettingsDirty,
    accountSettingsSaving,
    saveAndVerifyRunning,
  } = props;

  const propsRef = useRef(props);
  propsRef.current = props;
  const handlers = useMemo(() => createSettingsHandlers(propsRef), []);

  // Split the incoming state into per-section prop slices so a change in one
  // section's data does not re-render the pages of other sections.
  const accountProps = useMemo(() => ({
    accounts: props.accounts,
    accountForm: props.accountForm,
    accountCount: props.accounts.length,
    newAccountForm: props.newAccountForm,
    providerVerifications: props.providerVerifications,
    activeProviderVerification: props.activeProviderVerification,
    oauthClientId: props.oauthClientId,
    oauthClientSecret: props.oauthClientSecret,
    oauthRedirectUri: props.oauthRedirectUri,
    oauthCallbackState: props.oauthCallbackState,
    oauthCallbackCode: props.oauthCallbackCode,
    oauthReport: props.oauthReport,
    oauthCallbackReport: props.oauthCallbackReport,
    oauthExchangeReport: props.oauthExchangeReport,
    oauthRefreshReport: props.oauthRefreshReport,
    oauthSessions: props.oauthSessions,
    authTypeChanged: props.authTypeChanged,
    authTypeChangeNotice: props.authTypeChangeNotice,
    saveAndVerifyReport: props.saveAndVerifyReport,
  }), [
    props.accounts,
    props.accountForm,
    props.newAccountForm,
    props.providerVerifications,
    props.activeProviderVerification,
    props.oauthClientId,
    props.oauthClientSecret,
    props.oauthRedirectUri,
    props.oauthCallbackState,
    props.oauthCallbackCode,
    props.oauthReport,
    props.oauthCallbackReport,
    props.oauthExchangeReport,
    props.oauthRefreshReport,
    props.oauthSessions,
    props.authTypeChanged,
    props.authTypeChangeNotice,
    props.saveAndVerifyReport,
  ]);

  const credentialProps = useMemo(() => ({
    credentialSecret: props.credentialSecret,
    credentialStatus: props.credentialStatus,
    authTypeChangeNotice: props.authTypeChangeNotice,
    providerValidationRunning: props.providerValidationRunning,
  }), [
    props.credentialSecret,
    props.credentialStatus,
    props.authTypeChangeNotice,
    props.providerValidationRunning,
  ]);

  const experienceProps = useMemo(() => ({
    accounts: props.accounts,
    notificationPolicy: props.notificationPolicy,
    sendUndoDelaySeconds: props.sendUndoDelaySeconds,
    remoteImageTrusts: props.remoteImageTrusts,
    identities: props.identities,
    identityForm: props.identityForm,
  }), [
    props.accounts,
    props.notificationPolicy,
    props.sendUndoDelaySeconds,
    props.remoteImageTrusts,
    props.identities,
    props.identityForm,
  ]);

  const backupProps = useMemo(() => ({
    diagnosticExport: props.diagnosticExport,
    localBackupSummary: props.localBackupSummary,
    connectionReport: props.connectionReport,
    storageUsage: props.storageUsage,
    storageBusy: props.storageBusy,
  }), [
    props.diagnosticExport,
    props.localBackupSummary,
    props.connectionReport,
    props.storageUsage,
    props.storageBusy,
  ]);

  const syncProps = useMemo(() => ({
    imapProbe: props.imapProbe,
    syncSchedulePlan: props.syncSchedulePlan,
    imapMailboxes: props.imapMailboxes,
    folders: props.folders,
    outbox: props.outbox,
    writeValidationStatus: props.providerWriteValidationStatus,
    writeValidationLoading: props.providerWriteValidationLoading,
    writebackValidationProgress: props.providerWritebackValidationProgress,
  }), [
    props.imapProbe,
    props.syncSchedulePlan,
    props.imapMailboxes,
    props.folders,
    props.outbox,
    props.providerWriteValidationStatus,
    props.providerWriteValidationLoading,
    props.providerWritebackValidationProgress,
  ]);

  const contactsProps = useMemo(() => ({
    contactForm: props.contactForm,
    contactFormAliases: props.contactFormAliases,
    contacts: props.contacts,
    filteredContacts: props.filteredContacts,
    contactQuery: props.contactQuery,
    editingContactId: props.editingContactId,
    editName: props.contactEditName,
    editAliases: props.contactEditAliases,
    transferBusy: props.contactTransferBusy,
  }), [
    props.contactForm,
    props.contactFormAliases,
    props.contacts,
    props.filteredContacts,
    props.contactQuery,
    props.editingContactId,
    props.contactEditName,
    props.contactEditAliases,
    props.contactTransferBusy,
  ]);

  const rulesProps = useMemo(() => ({
    ruleForm: props.ruleForm,
    ruleBuilderField: props.ruleBuilderField,
    ruleBuilderNeedle: props.ruleBuilderNeedle,
    editingRuleId: props.editingRuleId,
    rules: props.rules,
    labels: props.labels,
  }), [
    props.ruleForm,
    props.ruleBuilderField,
    props.ruleBuilderNeedle,
    props.editingRuleId,
    props.rules,
    props.labels,
  ]);

  const securityPreviewProps = useMemo(() => ({
    rawMessage: props.rawMessage,
    parsedPreview: props.parsedPreview,
  }), [props.rawMessage, props.parsedPreview]);

  const isAccountSection = activeSettingsSection === 'accounts'
    || activeSettingsSection === 'providers'
    || activeSettingsSection === 'auth';
  const isExperienceSection = activeSettingsSection === 'sending'
    || activeSettingsSection === 'notifications'
    || activeSettingsSection === 'privacy'
    || activeSettingsSection === 'identities';

  const connectionReportForAccount = accountForm
    && props.connectionReport?.account_email === accountForm.email
    ? props.connectionReport
    : null;
  const credentialVerificationForAccount = accountForm
    && !props.authTypeChanged
    && props.credentialVerification?.account_email === accountForm.email
    ? props.credentialVerification
    : null;
  const providerValidationForAccount = accountForm
    && props.providerValidationReport?.account_email === accountForm.email
    ? props.providerValidationReport
    : null;

  return (
    <Suspense fallback={<DeferredSurface label="正在打开设置" />}>
      <SettingsFrame
        title="设置"
        subtitle={accountForm ? `${accountForm.email} · ${accountForm.provider}` : '未添加账号'}
        activeSection={activeSettingsSection}
        isDirty={accountSettingsDirty}
        isBusy={accountSettingsSaving || saveAndVerifyRunning}
        connectionSummary={props.saveAndVerifyReport.summary}
        canSaveAndVerify={Boolean(accountForm) && Boolean(props.onSaveAndVerify)}
        {...handlers}
      >
        <Suspense fallback={<div className="settings-page-loading" role="status">正在加载设置页面…</div>}>
          {isAccountSection && (
            <>
              <MemoizedAccountConnection
                section={activeSettingsSection}
                {...accountProps}
                {...handlers}
              />
              {activeSettingsSection === 'auth' && accountForm && (
                <MemoizedCredentialSecurity
                  account={accountForm}
                  connectionReport={connectionReportForAccount}
                  credentialVerification={credentialVerificationForAccount}
                  providerValidationReport={providerValidationForAccount}
                  {...credentialProps}
                  {...handlers}
                />
              )}
            </>
          )}
          {isExperienceSection && accountForm && (
            <MemoizedExperience
              section={activeSettingsSection}
              accountForm={accountForm}
              {...experienceProps}
              onNavigateToAi={() => handlers.onNavigate('ai')}
              {...handlers}
            />
          )}
          {activeSettingsSection === 'backup' && (
            <MemoizedDataSafety
              {...backupProps}
              {...handlers}
            />
          )}
          {activeSettingsSection === 'sync' && accountForm && (
            <MemoizedSyncOperations
              accountForm={accountForm}
              {...syncProps}
              {...handlers}
            />
          )}
          {activeSettingsSection === 'contacts' && (
            <MemoizedContactAutomation
              {...contactsProps}
              {...handlers}
            />
          )}
          {activeSettingsSection === 'rules' && (
            <MemoizedRuleAutomation
              {...rulesProps}
              {...handlers}
            />
          )}
          {activeSettingsSection === 'security-preview' && (
            <MemoizedSecurityPreview
              {...securityPreviewProps}
              {...handlers}
            />
          )}
          {activeSettingsSection === 'appearance' && (
            <MemoizedAppearance
              themeMode={props.themeMode}
              onThemeModeChange={props.onThemeModeChange}
            />
          )}
          {activeSettingsSection === 'ai' && (
            <MemoizedAiService />
          )}
          {activeSettingsSection === 'templates' && (
            <MemoizedTemplates onNavigateToAi={() => handlers.onNavigate('ai')} />
          )}
        </Suspense>
      </SettingsFrame>
    </Suspense>
  );
}
