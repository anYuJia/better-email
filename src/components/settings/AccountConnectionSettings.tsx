import type React from 'react';
import type {
  Account,
  AccountCreateInput,
  AccountScope,
  OAuthCallbackReport,
  OAuthRefreshReport,
  OAuthSession,
  OAuthStartReport,
  OAuthTokenExchangeReport,
} from '../../app/types';
import type { AccountProviderPreset } from '../../providerCatalog';
import type { SettingsSectionId } from './SettingsFrame';
import AccountSettingsPage from './pages/AccountSettingsPage';
import AuthenticationSettingsPage from './pages/AuthenticationSettingsPage';
import ProviderSettingsPage from './pages/ProviderSettingsPage';
import AccountScopeRequired from './shared/AccountScopeRequired';
import type { SettingsAccountValueChange, SettingsAccountValues } from './accountScopeTypes';

export type AccountConnectionSettingsProps = {
  section: 'accounts' | 'providers' | 'auth';
  accounts: Account[];
  accountScope: AccountScope;
  accountForm: Account | null;
  accountValues: SettingsAccountValues;
  accountCount: number;
  accountSwitchDisabled?: boolean;
  newAccountForm: AccountCreateInput;
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
  onAccountFormChange: (account: Account) => void;
  onAccountValueChange: SettingsAccountValueChange;
  onNewAccountFormChange: (account: AccountCreateInput) => void;
  onApplyProviderPreset: (preset: AccountProviderPreset) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: (secret?: string, onProgress?: (stage: string) => void) => Promise<void>;
  onRemoveAccount: (deleteSecret: boolean) => Promise<void>;
  onSaveAccountSettings?: (account: Account) => Promise<void>;
  onNavigate: (section: SettingsSectionId) => void;
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

export default function AccountConnectionSettings(props: AccountConnectionSettingsProps) {
  let page: React.ReactNode;

  if (props.section === 'accounts') {
    page = (
      <AccountSettingsPage
        accounts={props.accounts}
        accountScope={props.accountScope}
        accountForm={props.accountForm}
        accountValues={props.accountValues}
        accountCount={props.accountCount}
        accountSwitchDisabled={props.accountSwitchDisabled}
        newAccountForm={props.newAccountForm}
        onAccountFormChange={props.onAccountFormChange}
        onAccountValueChange={props.onAccountValueChange}
        onNewAccountFormChange={props.onNewAccountFormChange}
        onApplyNewAccountPreset={props.onApplyNewAccountPreset}
        onCreateNewAccount={props.onCreateNewAccount}
        onRemoveAccount={props.onRemoveAccount}
        onSaveAccountSettings={props.onSaveAccountSettings}
        onNavigate={props.onNavigate}
      />
    );
  } else if (props.accountScope === 'all' || !props.accountForm) {
    page = (
      <AccountScopeRequired
        accountScope={props.accountScope}
        accounts={props.accounts}
        onSelectAccount={props.onAccountFormChange}
      />
    );
  } else if (props.section === 'providers') {
    page = (
      <ProviderSettingsPage
        accountForm={props.accountForm}
        onAccountFormChange={props.onAccountFormChange}
        onApplyProviderPreset={props.onApplyProviderPreset}
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

  return <div className="settings-connection-shell">{page}</div>;
}
