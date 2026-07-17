import type {
  Account,
  OAuthCallbackReport,
  OAuthRefreshReport,
  OAuthSession,
  OAuthStartReport,
  OAuthTokenExchangeReport,
} from '../../../app/types';
import OAuthSettingsPanel from '../OAuthSettingsPanel';

type AuthenticationSettingsPageProps = {
  accountForm: Account;
  authTypeChanged: boolean;
  authTypeChangeNotice: string | null;
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

export default function AuthenticationSettingsPage({
  accountForm,
  authTypeChanged,
  authTypeChangeNotice,
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
  onAccountFormChange,
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
}: AuthenticationSettingsPageProps) {
  return (
    <div className="settings-account-stack settings-account-page settings-account-page-auth">
      <section className="tool-panel settings-auth-method-panel" data-settings-section="auth">
        <header className="tool-header">
          <span>
            <strong>认证方式</strong>
            <small>选择登录方式</small>
          </span>
          <em>{accountForm.auth_type === 'oauth2' ? 'OAuth2' : '授权码'}</em>
        </header>
        <label>
          登录方式
          <select
            value={accountForm.auth_type}
            onChange={(event) => onAccountFormChange({ ...accountForm, auth_type: event.target.value })}
          >
            <option value="password">应用专用密码 / 授权码</option>
            <option value="oauth2">OAuth2 Token</option>
          </select>
        </label>
        {authTypeChanged && authTypeChangeNotice && (
          <p className="settings-auth-change-notice" role="status">
            {authTypeChangeNotice}
          </p>
        )}
      </section>

      <OAuthSettingsPanel
        authType={accountForm.auth_type}
        clientId={oauthClientId}
        clientSecret={oauthClientSecret}
        redirectUri={oauthRedirectUri}
        callbackState={oauthCallbackState}
        callbackCode={oauthCallbackCode}
        report={oauthReport}
        callbackReport={oauthCallbackReport}
        exchangeReport={oauthExchangeReport}
        refreshReport={oauthRefreshReport}
        sessions={oauthSessions}
        onClientIdChange={onOauthClientIdChange}
        onClientSecretChange={onOauthClientSecretChange}
        onRedirectUriChange={onOauthRedirectUriChange}
        onCallbackStateChange={onOauthCallbackStateChange}
        onCallbackCodeChange={onOauthCallbackCodeChange}
        onStart={onStartOAuth2Pkce}
        onRefresh={onRefreshOAuth2Token}
        onCompleteCallback={onCompleteOAuth2Callback}
        onWaitForCallback={onWaitForOAuth2Callback}
        onExchange={onExchangeOAuth2Token}
      />
    </div>
  );
}
