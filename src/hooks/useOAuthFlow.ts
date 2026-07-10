import { useState, type Dispatch, type SetStateAction } from 'react';
import type {
  Account,
  OAuthCallbackReport,
  OAuthRefreshReport,
  OAuthSession,
  OAuthStartReport,
  OAuthTokenExchangeReport,
} from '../app/types';
import { invoke } from '../tauriBridge';

type OAuthFlowOptions = {
  accountForm: Account | null;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useOAuthFlow({
  accountForm,
  setStatus,
}: OAuthFlowOptions) {
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthRedirectUri, setOauthRedirectUri] = useState('http://127.0.0.1:17645/oauth/callback');
  const [oauthReport, setOauthReport] = useState<OAuthStartReport | null>(null);
  const [oauthSessions, setOauthSessions] = useState<OAuthSession[]>([]);
  const [oauthCallbackState, setOauthCallbackState] = useState('');
  const [oauthCallbackCode, setOauthCallbackCode] = useState('');
  const [oauthCallbackReport, setOauthCallbackReport] = useState<OAuthCallbackReport | null>(null);
  const [oauthExchangeReport, setOauthExchangeReport] = useState<OAuthTokenExchangeReport | null>(null);
  const [oauthRefreshReport, setOauthRefreshReport] = useState<OAuthRefreshReport | null>(null);

  async function reloadOAuthSessions() {
    setOauthSessions(await invoke<OAuthSession[]>('list_oauth_sessions'));
  }

  async function startOAuth2Pkce() {
    if (!accountForm) return;
    if (accountForm.auth_type !== 'oauth2') {
      setStatus('当前账号不是 OAuth2 模式');
      return;
    }
    if (!oauthClientId.trim()) {
      setStatus('请先填写 OAuth2 Client ID');
      return;
    }
    const report = await invoke<OAuthStartReport>('start_oauth2_pkce', {
      input: {
        provider: accountForm.provider,
        client_id: oauthClientId,
        redirect_uri: oauthRedirectUri,
        login_hint: accountForm.email,
      },
    });
    setOauthReport(report);
    await reloadOAuthSessions();
    setStatus(report.message);
  }

  async function completeOAuth2Callback() {
    if (!oauthCallbackState.trim() || !oauthCallbackCode.trim()) {
      setStatus('请填写 OAuth2 回调里的 state 和 code');
      return;
    }
    const report = await invoke<OAuthCallbackReport>('complete_oauth2_callback', {
      input: {
        state: oauthCallbackState,
        code: oauthCallbackCode,
      },
    });
    setOauthCallbackReport(report);
    setOauthCallbackCode('');
    await reloadOAuthSessions();
    setStatus(report.message);
  }

  async function waitForOAuth2Callback() {
    setStatus('正在监听 OAuth2 本地回调，请在浏览器完成授权');
    const report = await invoke<OAuthCallbackReport>('wait_for_oauth2_callback', {
      input: {
        redirect_uri: oauthRedirectUri,
        timeout_seconds: 180,
      },
    });
    setOauthCallbackReport(report);
    setOauthCallbackState(report.status === 'code_received' ? '' : oauthCallbackState);
    setOauthCallbackCode('');
    await reloadOAuthSessions();
    setStatus(report.message);
  }

  async function exchangeOAuth2Token(sessionId: number) {
    if (!oauthClientId.trim()) {
      setStatus('请先填写 OAuth2 Client ID');
      return;
    }
    const report = await invoke<OAuthTokenExchangeReport>('exchange_oauth2_token', {
      input: {
        session_id: sessionId,
        client_id: oauthClientId,
        client_secret: oauthClientSecret,
      },
    });
    setOauthExchangeReport(report);
    setOauthClientSecret('');
    await reloadOAuthSessions();
    setStatus(report.message);
  }

  async function refreshOAuth2Token() {
    if (!oauthClientId.trim()) {
      setStatus('请先填写 OAuth2 Client ID');
      return;
    }
    const report = await invoke<OAuthRefreshReport>('refresh_oauth2_token', {
      input: {
        client_id: oauthClientId,
        client_secret: oauthClientSecret,
      },
    });
    setOauthRefreshReport(report);
    setOauthClientSecret('');
    setStatus(report.message);
  }

  return {
    oauthClientId,
    setOauthClientId,
    oauthClientSecret,
    setOauthClientSecret,
    oauthRedirectUri,
    setOauthRedirectUri,
    oauthReport,
    oauthSessions,
    setOauthSessions,
    oauthCallbackState,
    setOauthCallbackState,
    oauthCallbackCode,
    setOauthCallbackCode,
    oauthCallbackReport,
    oauthExchangeReport,
    oauthRefreshReport,
    startOAuth2Pkce,
    completeOAuth2Callback,
    waitForOAuth2Callback,
    exchangeOAuth2Token,
    refreshOAuth2Token,
  };
}
