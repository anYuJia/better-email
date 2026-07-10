import { ExternalLink, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  OAuthCallbackReport,
  OAuthRefreshReport,
  OAuthSession,
  OAuthStartReport,
  OAuthTokenExchangeReport,
} from '../../app/types';
import { formatDate } from '../../mailUtils';

type OAuthSettingsPanelProps = {
  authType: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  callbackState: string;
  callbackCode: string;
  report: OAuthStartReport | null;
  callbackReport: OAuthCallbackReport | null;
  exchangeReport: OAuthTokenExchangeReport | null;
  refreshReport: OAuthRefreshReport | null;
  sessions: OAuthSession[];
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onRedirectUriChange: (value: string) => void;
  onCallbackStateChange: (value: string) => void;
  onCallbackCodeChange: (value: string) => void;
  onStart: () => void;
  onRefresh: () => void;
  onCompleteCallback: () => void;
  onWaitForCallback: () => void;
  onExchange: (sessionId: number) => void;
};

export default function OAuthSettingsPanel({
  authType,
  clientId,
  clientSecret,
  redirectUri,
  callbackState,
  callbackCode,
  report,
  callbackReport,
  exchangeReport,
  refreshReport,
  sessions,
  onClientIdChange,
  onClientSecretChange,
  onRedirectUriChange,
  onCallbackStateChange,
  onCallbackCodeChange,
  onStart,
  onRefresh,
  onCompleteCallback,
  onWaitForCallback,
  onExchange,
}: OAuthSettingsPanelProps) {
  return (
    <>
      <section className="oauth-guide settings-auth-guide" data-settings-section="auth">
        <span>
          {authType === 'oauth2' ? <ShieldCheck size={17} /> : <KeyRound size={17} />}
        </span>
        <div>
          <strong>{authType === 'oauth2' ? 'OAuth2 向导' : '授权码模式'}</strong>
          <p>
            {authType === 'oauth2'
              ? '支持 Gmail/Outlook PKCE 授权、回调授权码、Token 安全存储、自动刷新和 XOAUTH2 登录。'
              : '适用于 QQ、网易和自建邮箱的应用专用密码或授权码，凭据只写入系统安全存储。'}
          </p>
        </div>
      </section>

      {authType === 'oauth2' && (
        <details className="settings-disclosure" data-settings-section="auth" open>
          <summary>
            <span>
              <strong>OAuth2 高级流程</strong>
              <em>PKCE、回调、Token 交换与刷新</em>
            </span>
            <b>{sessions.length} 个会话</b>
          </summary>
          <section className="oauth-pkce-panel settings-oauth-panel">
            <div className="settings-oauth-grid">
              <label>
                OAuth2 Client ID
                <input
                  value={clientId}
                  onChange={(event) => onClientIdChange(event.target.value)}
                  placeholder="Gmail / Outlook 应用 Client ID"
                />
              </label>
              <label>
                Redirect URI
                <input
                  value={redirectUri}
                  onChange={(event) => onRedirectUriChange(event.target.value)}
                />
              </label>
              <label>
                Client Secret（可选）
                <input
                  value={clientSecret}
                  onChange={(event) => onClientSecretChange(event.target.value)}
                  placeholder="桌面 PKCE 通常可留空"
                  type="password"
                />
              </label>
            </div>
            <div className="settings-oauth-actions">
              <button type="button" onClick={onStart}>
                <ExternalLink size={14} />
                打开 OAuth2 授权页
              </button>
              <button type="button" className="secondary" onClick={onRefresh}>
                <RefreshCw size={14} />
                刷新已保存 Token
              </button>
            </div>
            {report && (
              <div className="oauth-result">
                <strong>{report.provider} · Session #{report.session_id}</strong>
                <span>{report.code_verifier_hint}</span>
                <small>Scopes: {report.scopes.join(', ')}</small>
                <em>State: {report.state}</em>
              </div>
            )}
            <div className="oauth-callback-form settings-oauth-callback">
              <input
                value={callbackState}
                onChange={(event) => onCallbackStateChange(event.target.value)}
                placeholder="回调 state"
              />
              <input
                value={callbackCode}
                onChange={(event) => onCallbackCodeChange(event.target.value)}
                placeholder="授权码 code"
                type="password"
              />
              <button type="button" onClick={onCompleteCallback}>记录回调授权码</button>
              <button type="button" className="secondary" onClick={onWaitForCallback}>监听本地回调</button>
            </div>
            {callbackReport && (
              <div className="oauth-result">
                <strong>{callbackReport.provider} · {callbackReport.status}</strong>
                <span>Session #{callbackReport.session_id}</span>
                <small>{callbackReport.message}</small>
              </div>
            )}
            {exchangeReport && (
              <div className="oauth-result">
                <strong>{exchangeReport.provider} · {exchangeReport.status}</strong>
                <span>Session #{exchangeReport.session_id}</span>
                <small>
                  {exchangeReport.expires_at
                    ? `Access token 过期时间：${formatDate(exchangeReport.expires_at)}`
                    : exchangeReport.message}
                </small>
              </div>
            )}
            {refreshReport && (
              <div className="oauth-result">
                <strong>{refreshReport.provider} · {refreshReport.status}</strong>
                <span>{refreshReport.message}</span>
                <small>Access token 过期时间：{formatDate(refreshReport.expires_at)}</small>
              </div>
            )}
            {sessions.length > 0 && (
              <div className="oauth-session-list settings-oauth-sessions">
                {sessions.slice(0, 3).map((session) => (
                  <div key={session.id}>
                    <strong>{session.provider} · {session.status}</strong>
                    <span>{formatDate(session.created_at)} · {session.redirect_uri}</span>
                    <small>{session.scopes.join(', ')}</small>
                    {(session.status === 'code_received' || session.status === 'token_exchange_failed') && (
                      <button type="button" onClick={() => onExchange(session.id)}>
                        交换并保存 Token
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </details>
      )}
    </>
  );
}
