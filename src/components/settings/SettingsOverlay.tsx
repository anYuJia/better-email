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
  AccountScope,
  AppSettingsReport,
  BackgroundTaskKind,
  Contact,
  ContactCreateInput,
  CredentialStatus,
  Folder,
  ImapMailboxState,
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
  RemoteImageTrust,
  StorageUsage,
} from '../../app/types';
import type {
  RuleConditionField,
  SendUndoDelaySeconds,
} from '../../app/appConfig';
import type { AccountProviderPreset } from '../../providerCatalog';
import type { NotificationPolicy } from '../../mailUtils';
import type { ThemeMode } from '../../hooks/useThemeMode';
import type { SettingsSectionId } from './SettingsFrame';
import type { SettingsAccountValueChange, SettingsAccountValues } from './accountScopeTypes';
import DeferredSurface from '../DeferredSurface';
import SettingsFrame from './SettingsFrame';
import { createSettingsHandlers } from './settingsOverlayHandlers';

const AccountConnectionSettings = lazy(() => import('./AccountConnectionSettings'));
const CredentialSecuritySettings = lazy(() => import('./CredentialSecuritySettings'));
const ExperienceSettings = lazy(() => import('./ExperienceSettings'));
const GeneralSettings = lazy(() => import('./GeneralSettings'));
const DataSafetySettings = lazy(() => import('./DataSafetySettings'));
const SyncOperationsSettings = lazy(() => import('./SyncOperationsSettings'));
const ContactAutomationSettings = lazy(() => import('./ContactAutomationSettings'));
const RuleAutomationSettings = lazy(() => import('./RuleAutomationSettings'));
const ToolsSettingsPage = lazy(() => import('./ToolsSettingsPage'));
const AiServiceSettings = lazy(() => import('./AiServiceSettings'));
const McpSettings = lazy(() => import('./McpSettings'));
const TemplateSettings = lazy(() => import('./TemplateSettings'));
const AboutSettings = lazy(() => import('./AboutSettings'));

export type SettingsOverlayProps = {
  standalone?: boolean;
  nativeCloseRequestVersion?: number;
  onReady?: () => void;
  accountForm: Account | null;
  accounts: Account[];
  accountScope: AccountScope;
  accountValues: SettingsAccountValues;
  unifiedAccountSettingsDirty: boolean;
  unifiedAccountSettingsSaving: boolean;
  newAccountForm: AccountCreateInput;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  activeSettingsSection: SettingsSectionId;
  accountSettingsDirty: boolean;
  accountSettingsSaving: boolean;
  saveAndVerifyRunning: boolean;
  connectionTestRunning?: boolean;
  connectionTestFeedback?: { tone: 'success' | 'error'; message: string } | null;
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
  credentialSecret: string;
  credentialStatus: CredentialStatus | null;
  notificationPolicy: NotificationPolicy;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  remoteImageTrusts: RemoteImageTrust[];
  identities: MailIdentity[];
  identityForm: MailIdentityInput;
  localBackupSummary: LocalBackupSummary | null;
  storageUsage: StorageUsage | null;
  storageBusy: boolean;
  appSettings: AppSettingsReport | null;
  downloadDirBusy: boolean;
  downloadDirError: string | null;
  imapMailboxes: ImapMailboxState[];
  folders: Folder[];
  labels: Label[];
  rules: MailRule[];
  ruleForm: MailRuleInput;
  ruleBuilderField: RuleConditionField;
  ruleBuilderNeedle: string;
  editingRuleId: number | null;
  contactForm: ContactCreateInput;
  contactFormAliases: string;
  contacts: Contact[];
  editingContactId: number | null;
  contactEditName: string;
  contactEditAliases: string;
  contactTransferBusy: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
  onNavigate: (section: SettingsSectionId) => void;
  onClose: () => void;
  onTestConnection: () => void;
  onSave: () => void;
  onDiscardUnifiedSettings: () => void;
  onSaveAndVerify: (() => void) | undefined;
  onAccountFormChange: Dispatch<SetStateAction<Account | null>>;
  onAccountValueChange: SettingsAccountValueChange;
  onAccountScopeChange: (value: string) => void;
  onSetDefaultAccount: (accountId: number) => void;
  onNewAccountFormChange: Dispatch<SetStateAction<AccountCreateInput>>;
  onApplyProviderPreset: (preset: AccountProviderPreset) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: (secret?: string, onProgress?: (stage: string) => void) => Promise<void>;
  onRemoveAccount: (deleteSecret: boolean) => Promise<void>;
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
  onVerifyCredential: () => void;
  onDeleteCredential: () => void;
  onStoreAndVerifyCredential: () => void;
  onNotificationPolicyChange: Dispatch<SetStateAction<NotificationPolicy>>;
  onSendUndoDelayChange: Dispatch<SetStateAction<SendUndoDelaySeconds>>;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
  onIdentityFormChange: Dispatch<SetStateAction<MailIdentityInput>>;
  onEditIdentity: (identity: MailIdentity) => void;
  onDeleteIdentity: (identity: MailIdentity) => void;
  onSaveIdentity: () => Promise<void>;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onClearAttachmentCache: () => Promise<void>;
  onPickDownloadDir: () => void;
  onResetDownloadDir: () => void;
  onMapImapMailbox: (mailbox: ImapMailboxState, folderId: number | null) => void;
  onCreateAndMapImapMailbox: (mailbox: ImapMailboxState) => void;
  onEnqueueBackgroundTask: (kind: BackgroundTaskKind, source: 'manual' | 'timer') => void;
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
};

const MemoizedAccountConnection = memo(AccountConnectionSettings);
const MemoizedCredentialSecurity = memo(CredentialSecuritySettings);
const MemoizedExperience = memo(ExperienceSettings);
const MemoizedGeneral = memo(GeneralSettings);
const MemoizedDataSafety = memo(DataSafetySettings);
const MemoizedSyncOperations = memo(SyncOperationsSettings);
const MemoizedContactAutomation = memo(ContactAutomationSettings);
const MemoizedRuleAutomation = memo(RuleAutomationSettings);
const MemoizedTools = memo(ToolsSettingsPage);
const MemoizedAiService = memo(AiServiceSettings);
const MemoizedMcp = memo(McpSettings);
const MemoizedTemplates = memo(TemplateSettings);
const MemoizedAbout = memo(AboutSettings);

export default function SettingsOverlay(props: SettingsOverlayProps) {
  const {
    accountForm,
    activeSettingsSection,
    accountSettingsDirty,
    accountSettingsSaving,
    saveAndVerifyRunning,
  } = props;
  const unifiedSettingsDirty = props.accountScope === 'all' && props.unifiedAccountSettingsDirty;
  const settingsDirty = props.accountScope === 'all' ? unifiedSettingsDirty : accountSettingsDirty;
  const settingsBusy = props.accountScope === 'all'
    ? props.unifiedAccountSettingsSaving
    : accountSettingsSaving || saveAndVerifyRunning;

  const propsRef = useRef(props);
  propsRef.current = props;
  const handlers = useMemo(() => createSettingsHandlers(propsRef), []);

  const accountProps = useMemo(() => ({
    accounts: props.accounts,
    accountScope: props.accountScope,
    accountForm: props.accountForm,
    accountValues: props.accountValues,
    accountCount: props.accounts.length,
    accountSwitchDisabled: settingsDirty,
    newAccountForm: props.newAccountForm,
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
  }), [
    props.accounts,
    props.accountScope,
    props.accountForm,
    props.accountValues,
    settingsDirty,
    props.newAccountForm,
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
  ]);

  const credentialProps = useMemo(() => ({
    credentialSecret: props.credentialSecret,
    credentialStatus: props.credentialStatus,
    authTypeChangeNotice: props.authTypeChangeNotice,
  }), [
    props.credentialSecret,
    props.credentialStatus,
    props.authTypeChangeNotice,
  ]);

  const experienceProps = useMemo(() => ({
    accountScope: props.accountScope,
    accounts: props.accounts,
    accountValues: props.accountValues,
    remoteImageTrusts: props.remoteImageTrusts,
    identities: props.identities,
    identityForm: props.identityForm,
  }), [
    props.accountScope,
    props.accounts,
    props.accountValues,
    props.remoteImageTrusts,
    props.identities,
    props.identityForm,
  ]);

  const backupProps = useMemo(() => ({
    localBackupSummary: props.localBackupSummary,
    storageUsage: props.storageUsage,
    storageBusy: props.storageBusy,
    appSettings: props.appSettings,
    downloadDirBusy: props.downloadDirBusy,
    downloadDirError: props.downloadDirError,
  }), [
    props.localBackupSummary,
    props.storageUsage,
    props.storageBusy,
    props.appSettings,
    props.downloadDirBusy,
    props.downloadDirError,
  ]);

  const syncProps = useMemo(() => ({
    accountScope: props.accountScope,
    accounts: props.accounts,
    accountForm: props.accountForm,
    accountValues: props.accountValues,
    imapMailboxes: props.imapMailboxes,
    folders: props.folders,
  }), [
    props.accountScope,
    props.accounts,
    props.accountForm,
    props.accountValues,
    props.imapMailboxes,
    props.folders,
  ]);

  const contactsProps = useMemo(() => ({
    accountScope: props.accountScope,
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
    props.accountScope,
  ]);

  const rulesProps = useMemo(() => ({
    accountScope: props.accountScope,
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
    props.accountScope,
  ]);

  const isAccountSection = activeSettingsSection === 'accounts'
    || activeSettingsSection === 'providers'
    || activeSettingsSection === 'auth';
  const isExperienceSection = activeSettingsSection === 'privacy'
    || activeSettingsSection === 'identities';

  return (
    <Suspense fallback={<DeferredSurface label="正在打开设置" />}>
      <SettingsFrame
        title="设置"
        standalone={props.standalone}
        nativeCloseRequestVersion={props.nativeCloseRequestVersion}
        onReady={props.onReady}
        activeSection={activeSettingsSection}
        accounts={props.accounts}
        accountScope={props.accountScope}
        onAccountScopeChange={props.onAccountScopeChange}
        onDiscardChanges={() => {
          if (props.accountScope === 'all') {
            props.onDiscardUnifiedSettings();
          } else if (props.accountForm) {
            const persisted = props.accounts.find((account) => account.id === props.accountForm?.id);
            if (persisted) handlers.onAccountFormChange(persisted);
          }
        }}
        onSetDefaultAccount={props.onSetDefaultAccount}
        onAddAccount={() => props.onNavigate('accounts')}
        isDirty={settingsDirty}
        isBusy={settingsBusy || Boolean(props.connectionTestRunning)}
        isTestingConnection={props.connectionTestRunning}
        connectionTestFeedback={props.connectionTestFeedback}
        canSaveAndVerify={props.accountScope !== 'all' && Boolean(accountForm) && Boolean(props.onSaveAndVerify)}
        canSave={settingsDirty && (props.accountScope === 'all' ? props.accounts.length > 0 : Boolean(accountForm))}
        {...handlers}
      >
        <Suspense fallback={<div className="settings-page-loading" role="status">正在加载设置页面…</div>}>
          {isAccountSection && (
            <>
              <MemoizedAccountConnection
                section={activeSettingsSection}
                {...accountProps}
                onAccountValueChange={props.onAccountValueChange}
                {...handlers}
              />
              {activeSettingsSection === 'auth' && props.accountScope !== 'all' && accountForm && (
                <MemoizedCredentialSecurity
                  account={accountForm}
                  {...credentialProps}
                  {...handlers}
                />
              )}
            </>
          )}
          {isExperienceSection && (
            <MemoizedExperience
              section={activeSettingsSection}
              accountForm={accountForm}
              {...experienceProps}
              onAccountValueChange={props.onAccountValueChange}
              onNavigateToAi={() => handlers.onNavigate('ai')}
              {...handlers}
            />
          )}
          {activeSettingsSection === 'general' && (
            <MemoizedGeneral
              themeMode={props.themeMode}
              notificationPolicy={props.notificationPolicy}
              sendUndoDelaySeconds={props.sendUndoDelaySeconds}
              onThemeModeChange={props.onThemeModeChange}
              onNotificationPolicyChange={handlers.onNotificationPolicyChange}
              onSendUndoDelayChange={handlers.onSendUndoDelayChange}
            />
          )}
          {activeSettingsSection === 'backup' && (
            <MemoizedDataSafety
              {...backupProps}
              {...handlers}
            />
          )}
          {activeSettingsSection === 'sync' && (
            <MemoizedSyncOperations
              {...syncProps}
              onAccountValueChange={props.onAccountValueChange}
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
          {activeSettingsSection === 'tools' && (
            <MemoizedTools onNavigate={handlers.onNavigate} />
          )}
          {activeSettingsSection === 'ai' && (
            <MemoizedAiService />
          )}
          {activeSettingsSection === 'mcp' && (
            <MemoizedMcp />
          )}
          {activeSettingsSection === 'templates' && (
            <MemoizedTemplates
              accountScope={props.accountScope}
              accounts={props.accounts}
              onNavigateToAi={() => handlers.onNavigate('ai')}
            />
          )}
          {activeSettingsSection === 'about' && (
            <MemoizedAbout />
          )}
        </Suspense>
      </SettingsFrame>
    </Suspense>
  );
}
