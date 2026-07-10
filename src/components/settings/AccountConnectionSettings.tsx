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
import type { AccountProviderPreset } from '../../providerCatalog';
import AccountSettingsPage from './pages/AccountSettingsPage';
import AuthenticationSettingsPage from './pages/AuthenticationSettingsPage';
import ProviderSettingsPage from './pages/ProviderSettingsPage';
import './account-settings.css';

export type AccountConnectionSettingsProps = {
  section: 'accounts' | 'providers' | 'auth';
  accountForm: Account;
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
  onAccountFormChange: (account: Account) => void;
  onNewAccountFormChange: (account: AccountCreateInput) => void;
  onApplyProviderPreset: (preset: AccountProviderPreset) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: () => void;
  onRemoveAccount: () => Promise<void>;
  onUpdateProviderVerification: (
    providerName: string,
    patch: Partial<ProviderVerificationRecord>,
  ) => void;
  onSaveProviderVerification: () => void;
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
  if (props.section === 'accounts') {
    return (
      <AccountSettingsPage
        accountForm={props.accountForm}
        accountCount={props.accountCount}
        newAccountForm={props.newAccountForm}
        onAccountFormChange={props.onAccountFormChange}
        onNewAccountFormChange={props.onNewAccountFormChange}
        onApplyNewAccountPreset={props.onApplyNewAccountPreset}
        onCreateNewAccount={props.onCreateNewAccount}
        onRemoveAccount={props.onRemoveAccount}
      />
    );
  }

  if (props.section === 'providers') {
    return (
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
  }

  return (
    <AuthenticationSettingsPage
      accountForm={props.accountForm}
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
