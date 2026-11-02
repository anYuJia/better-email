import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Account, OAuthCallbackReport, OAuthRefreshReport, OAuthSession, OAuthStartReport, OAuthTokenExchangeReport } from '../app/types';
import { notifyCredentialsChanged } from '../app/credentialEvents';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type OAuthFlowOptions = { accountForm: Account | null; setStatus: Dispatch<SetStateAction<string>> };

export default function useOAuthFlow({ accountForm, setStatus }: OAuthFlowOptions) {
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
  const scope = `${accountForm?.id}:${accountForm?.auth_type}:${accountForm?.provider}`;
  const context = useRef({ scope, generation: 0 });
  const pending = useRef<Promise<void> | null>(null);
  const secretRef = useRef(oauthClientSecret);
  secretRef.current = oauthClientSecret;
  if (context.current.scope !== scope) {
    context.current = { scope, generation: context.current.generation + 1 };
    pending.current = null;
  }
  useEffect(() => {
    setOauthClientSecret(''); setOauthCallbackCode(''); setOauthCallbackState('');
    setOauthReport(null); setOauthCallbackReport(null); setOauthExchangeReport(null); setOauthRefreshReport(null);
    setOauthSessions([]);
    return () => { context.current.generation += 1; };
  }, [scope]);

  function operate(task: (account: Account, current: () => boolean) => Promise<void>) {
    if (pending.current) return pending.current;
    if (!accountForm || accountForm.auth_type !== 'oauth2') {
      setStatus('请先选择已保存为 OAuth2 认证方式的账号');
      return Promise.resolve();
    }
    const generation = context.current.generation;
    const current = () => context.current.scope === scope && context.current.generation === generation;
    const work = task(accountForm, current).catch((error) => { if (current()) throw error; }).finally(() => { if (current()) pending.current = null; });
    pending.current = work;
    return work;
  }

  async function reloadSessions(accountId: number, current: () => boolean) {
    const sessions = await invoke<OAuthSession[]>(IPC.ListOauthSessions, { accountId });
    if (current()) setOauthSessions(sessions);
  }

  function requireClientId() {
    if (oauthClientId.trim()) return true;
    setStatus('请先填写 OAuth2 Client ID');
    return false;
  }

  function startOAuth2Pkce() {
    if (!requireClientId()) return Promise.resolve();
    return operate(async (account, current) => {
      const report = await invoke<OAuthStartReport>(IPC.StartOauth2Pkce, {
        accountId: account.id,
        input: { provider: account.provider, client_id: oauthClientId, redirect_uri: oauthRedirectUri, login_hint: account.email },
      });
      if (!current()) return;
      setOauthReport(report); setStatus(report.message);
      await reloadSessions(account.id, current);
    });
  }

  function completeOAuth2Callback() {
    if (!oauthCallbackState.trim() || !oauthCallbackCode.trim()) {
      setStatus('请填写 OAuth2 回调里的 state 和 code');
      return Promise.resolve();
    }
    return operate(async (account, current) => {
      const report = await invoke<OAuthCallbackReport>(IPC.CompleteOauth2Callback, {
        input: { state: oauthCallbackState, code: oauthCallbackCode },
      });
      if (!current()) return;
      setOauthCallbackReport(report); setOauthCallbackCode(''); setStatus(report.message);
      await reloadSessions(account.id, current);
    });
  }

  function waitForOAuth2Callback() {
    return operate(async (account, current) => {
      setStatus('正在监听 OAuth2 本地回调，请在浏览器完成授权');
      const report = await invoke<OAuthCallbackReport>(IPC.WaitForOauth2Callback, {
        accountId: account.id, input: { redirect_uri: oauthRedirectUri, timeout_seconds: 180 },
      });
      if (!current()) return;
      setOauthCallbackReport(report);
      if (report.status === 'code_received') setOauthCallbackState('');
      setOauthCallbackCode(''); setStatus(report.message);
      await reloadSessions(account.id, current);
    });
  }

  function exchangeOAuth2Token(sessionId: number) {
    if (!requireClientId()) return Promise.resolve();
    const capturedSecret = oauthClientSecret;
    return operate(async (account, current) => {
      const report = await invoke<OAuthTokenExchangeReport>(IPC.ExchangeOauth2Token, {
        accountId: account.id, input: { session_id: sessionId, client_id: oauthClientId, client_secret: capturedSecret },
      });
      notifyCredentialsChanged();
      if (!current()) return;
      setOauthExchangeReport(report);
      if (secretRef.current === capturedSecret) setOauthClientSecret('');
      setStatus(report.message);
      await reloadSessions(account.id, current);
    });
  }

  function refreshOAuth2Token() {
    if (!requireClientId()) return Promise.resolve();
    const capturedSecret = oauthClientSecret;
    return operate(async (account, current) => {
      const report = await invoke<OAuthRefreshReport>(IPC.RefreshOauth2Token, {
        accountId: account.id, input: { client_id: oauthClientId, client_secret: capturedSecret },
      });
      notifyCredentialsChanged();
      if (!current()) return;
      setOauthRefreshReport(report);
      if (secretRef.current === capturedSecret) setOauthClientSecret('');
      setStatus(report.message);
    });
  }

  return {
    oauthClientId, setOauthClientId, oauthClientSecret, setOauthClientSecret, oauthRedirectUri, setOauthRedirectUri,
    oauthReport, oauthSessions, setOauthSessions, oauthCallbackState, setOauthCallbackState, oauthCallbackCode,
    setOauthCallbackCode, oauthCallbackReport, oauthExchangeReport, oauthRefreshReport,
    startOAuth2Pkce, completeOAuth2Callback, waitForOAuth2Callback, exchangeOAuth2Token, refreshOAuth2Token,
  };
}
