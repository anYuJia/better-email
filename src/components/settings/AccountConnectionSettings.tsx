import type React from 'react';
import type {
  Account,
  AccountCreateInput,
  OAuthCallbackReport,
  OAuthRefreshReport,
  OAuthSession,
  OAuthStartReport,
  OAuthTokenExchangeReport,
  ProviderVerificationRecord,
} from '../../app/types';
import type { SaveAndVerifyReport } from '../../app/accountConnectionSettings';
import type { AccountProviderPreset } from '../../providerCatalog';
import AccountSettingsPage from './pages/AccountSettingsPage';
import AuthenticationSettingsPage from './pages/AuthenticationSettingsPage';
import ProviderSettingsPage from './pages/ProviderSettingsPage';
import './account-settings.css';

export type AccountConnectionSettingsProps = {
  section: 'accounts' | 'providers' | 'auth';
  accounts: Account[];
  accountForm: Account | null;
  accountCount: number;
  newAccountForm: AccountCreateInput;
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
  saveAndVerifyReport: SaveAndVerifyReport;
  onAccountFormChange: (account: Account) => void;
  onNewAccountFormChange: (account: AccountCreateInput) => void;
  onApplyProviderPreset: (preset: AccountProviderPreset) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: (secret?: string) => Promise<void>;
  onRemoveAccount: (deleteSecret: boolean) => Promise<void>;
  onUpdateProviderVerification: (
    providerName: string,
    patch: Partial<ProviderVerificationRecord>,
  ) => void;
  onSaveProviderVerification: () => void;
  onSaveAccountSettings?: (account: Account) => Promise<void>;
  onOauthClientIdChange: (value: string) => void;
  onOauthClientSecretChange: (value: string) => void;
  onOauthRedirectUriChange: (value: string) => void;
  onOauthCallbackStateChange: (value: string) => void;
  onOauthCallbackCodeChange: (value: string) => void;
  onStartOAuth2Pkce: () => void;
  onRefreshOAuth2Token: () => void;
  onCompleteOAuth2Callback: () => void;
  onWaitForOAuth2Callback: () => void;
  onExchangeOAuth2Token: (sessionId: number) => void;
};

const connectionSteps = [
  { id: 'accounts', index: '01', label: '账号', detail: '邮箱与显示名称' },
  { id: 'providers', index: '02', label: '连接', detail: '服务商与服务器' },
  { id: 'auth', index: '03', label: '认证', detail: '密码或 OAuth2' },
] as const;

const saveAndVerifyStateLabels = {
  pending: '等待',
  running: '进行中',
  success: '通过',
  partial: '部分通过',
  error: '失败',
  needs_auth: '需要认证',
} as const;

function ConnectionFlowHeader({ section }: { section: AccountConnectionSettingsProps['section'] }) {
  const activeIndex = connectionSteps.findIndex((step) => step.id === section);

  return (
    <nav className="settings-connection-flow" aria-label="账号连接流程">
      {connectionSteps.map((step, index) => (
        <span
          className={[
            'settings-connection-step',
            index === activeIndex ? 'active' : '',
            index < activeIndex ? 'complete' : '',
          ].filter(Boolean).join(' ')}
          key={step.id}
        >
          <b>{step.index}</b>
          <span>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </span>
        </span>
      ))}
    </nav>
  );
}

export default function AccountConnectionSettings(props: AccountConnectionSettingsProps) {
  const showSaveAndVerifyStatus = Boolean(props.accountForm)
    && props.saveAndVerifyReport.overall !== 'pending';
  let page: React.ReactNode;

  if (props.section === 'accounts' || !props.accountForm) {
    page = (
      <AccountSettingsPage
        accounts={props.accounts}
        accountForm={props.accountForm}
        accountCount={props.accountCount}
        newAccountForm={props.newAccountForm}
        onAccountFormChange={props.onAccountFormChange}
        onNewAccountFormChange={props.onNewAccountFormChange}
        onApplyNewAccountPreset={props.onApplyNewAccountPreset}
        onCreateNewAccount={props.onCreateNewAccount}
        onRemoveAccount={props.onRemoveAccount}
        onSaveAccountSettings={props.onSaveAccountSettings}
      />
    );
  } else if (props.section === 'providers') {
    page = (
      <ProviderSettingsPage
        accountForm={props.accountForm}
        providerVerifications={props.providerVerifications}
        activeProviderVerification={props.activeProviderVerification}
        onAccountFormChange={props.onAccountFormChange}
        onApplyProviderPreset={props.onApplyProviderPreset}
        onUpdateProviderVerification={props.onUpdateProviderVerification}
        onSaveProviderVerification={props.onSaveProviderVerification}
      />
    );
  } else {
    page = (
      <AuthenticationSettingsPage
        accountForm={props.accountForm}
        authTypeChanged={props.authTypeChanged}
        authTypeChangeNotice={props.authTypeChangeNotice}
        oauthClientId={props.oauthClientId}
        oauthClientSecret={props.oauthClientSecret}
        oauthRedirectUri={props.oauthRedirectUri}
        oauthCallbackState={props.oauthCallbackState}
        oauthCallbackCode={props.oauthCallbackCode}
        oauthReport={props.oauthReport}
        oauthCallbackReport={props.oauthCallbackReport}
        oauthExchangeReport={props.oauthExchangeReport}
        oauthRefreshReport={props.oauthRefreshReport}
        oauthSessions={props.oauthSessions}
        onAccountFormChange={props.onAccountFormChange}
        onOauthClientIdChange={props.onOauthClientIdChange}
        onOauthClientSecretChange={props.onOauthClientSecretChange}
        onOauthRedirectUriChange={props.onOauthRedirectUriChange}
        onOauthCallbackStateChange={props.onOauthCallbackStateChange}
        onOauthCallbackCodeChange={props.onOauthCallbackCodeChange}
        onStartOAuth2Pkce={props.onStartOAuth2Pkce}
        onRefreshOAuth2Token={props.onRefreshOAuth2Token}
        onCompleteOAuth2Callback={props.onCompleteOAuth2Callback}
        onWaitForOAuth2Callback={props.onWaitForOAuth2Callback}
        onExchangeOAuth2Token={props.onExchangeOAuth2Token}
      />
    );
  }

  return (
    <div className="settings-connection-shell">
      <ConnectionFlowHeader section={props.section} />
      {showSaveAndVerifyStatus && (
        <section
          className={`settings-save-verify-status ${props.saveAndVerifyReport.overall}`}
          aria-label="账号保存与验证状态"
        >
          <header>
            <span>
              <strong>账号连接状态</strong>
              <small>{props.saveAndVerifyReport.summary}</small>
            </span>
            <em>{saveAndVerifyStateLabels[props.saveAndVerifyReport.overall]}</em>
          </header>
          <div className="settings-save-verify-stages">
            {props.saveAndVerifyReport.stages.map((stage) => (
              <span className={stage.state} key={stage.id}>
                <b>{stage.label}</b>
                <small>{stage.detail}</small>
              </span>
            ))}
          </div>
          {props.saveAndVerifyReport.technicalDetails.length > 0 && (
            <details>
              <summary>技术详情</summary>
              <pre>{props.saveAndVerifyReport.technicalDetails.join('\n')}</pre>
            </details>
          )}
        </section>
      )}
      {page}
    </div>
  );
}
