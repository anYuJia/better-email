import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import type { AccountCreateInput, IncomingProtocol } from '../app/types';
import { providerPresetForEmail } from '../providerCatalog';
import {
  accountFormForEmail,
  accountFormForIncomingProtocol,
} from './settings/accounts/accountSetupForm';
import './account-login-dialog.css';

type AccountLoginDialogProps = {
  form: AccountCreateInput;
  onFormChange: (form: AccountCreateInput) => void;
  onSubmit: (secret: string, onProgress: (stage: string) => void) => Promise<unknown>;
};

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error:\s*/i, '')
    .trim() || '登录失败，请检查邮箱和授权码。';
}

export default function AccountLoginDialog({
  form,
  onFormChange,
  onSubmit,
}: AccountLoginDialogProps) {
  const [secret, setSecret] = useState('');
  const [secretVisible, setSecretVisible] = useState(false);
  const [manualSettingsOpen, setManualSettingsOpen] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittingStage, setSubmittingStage] = useState('');
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  const matchedPreset = providerPresetForEmail(form.email);
  const isServerReady = Boolean(form.imap_host.trim() && form.smtp_host.trim());
  const secretLabel = form.auth_type === 'oauth2' ? 'OAuth2 Token' : '授权码 / 应用密码';
  const secretPlaceholder = form.auth_type === 'oauth2'
    ? '访问或刷新 Token'
    : matchedPreset?.provider === 'qq'
      ? 'QQ 邮箱授权码'
      : matchedPreset?.provider === 'netease'
        ? '网易客户端授权码'
        : '应用专用密码或授权码';
  const canSubmit = Boolean(form.email.trim() && secret.trim() && isServerReady);

  useEffect(() => {
    mountedRef.current = true;
    emailInputRef.current?.focus();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    const parent = overlay?.parentElement;
    if (!overlay || !parent) return undefined;
    const siblings = Array.from(parent.children).filter((element) => element !== overlay);
    const previousAccessibilityState = new Map<Element, {
      inert: boolean;
      ariaHidden: string | null;
    }>();
    for (const sibling of siblings) {
      previousAccessibilityState.set(sibling, {
        inert: sibling.hasAttribute('inert'),
        ariaHidden: sibling.getAttribute('aria-hidden'),
      });
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }
    return () => {
      for (const sibling of siblings) {
        const previousState = previousAccessibilityState.get(sibling);
        if (!previousState) continue;
        if (previousState.inert) {
          sibling.setAttribute('inert', '');
        } else {
          sibling.removeAttribute('inert');
        }
        if (previousState.ariaHidden === null) {
          sibling.removeAttribute('aria-hidden');
        } else {
          sibling.setAttribute('aria-hidden', previousState.ariaHidden);
        }
      }
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const focusableSelector = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => (
          !element.hasAttribute('disabled')
          && !element.hidden
          && element.getAttribute('aria-hidden') !== 'true'
        ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, []);

  function updateEmail(email: string) {
    setError('');
    onFormChange(accountFormForEmail(form, email));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!form.email.trim()) {
      setError('请输入邮箱地址。');
      return;
    }
    if (!secret.trim()) {
      setError(`请输入${secretLabel}。`);
      return;
    }
    if (!isServerReady) {
      setManualSettingsOpen(true);
      setError('请补充收信与发信服务器。');
      return;
    }

    setError('');
    setSubmitting(true);
    setSubmittingStage('正在连接邮箱...');
    try {
      await onSubmit(secret, (stage) => {
        if (mountedRef.current) setSubmittingStage(stage);
      });
    } catch (nextError) {
      if (mountedRef.current) setError(errorMessage(nextError));
    } finally {
      if (mountedRef.current) {
        setSubmitting(false);
        setSubmittingStage('');
      }
    }
  }

  return (
    <div className="account-login-gate" ref={overlayRef}>
      <section className="account-login-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="account-login-title">
        <header className="account-login-header">
          <img src="/brand/v4/brand-mark.png" alt="Better Email" />
          <span>
            <strong id="account-login-title">登录邮箱</strong>
            <small>连接你的收件箱</small>
          </span>
        </header>

        <form onSubmit={handleSubmit}>
          <label className="account-login-field">
            <span>邮箱地址</span>
            <span className="account-login-input-wrap">
              <Mail size={15} aria-hidden="true" />
              <input
                ref={emailInputRef}
                autoComplete="email"
                inputMode="email"
                value={form.email}
                onChange={(event) => updateEmail(event.target.value)}
                placeholder="name@example.com"
                aria-invalid={Boolean(error)}
              />
            </span>
          </label>

          <label className="account-login-field">
            <span>{secretLabel}</span>
            <span className="account-login-input-wrap">
              <ShieldCheck size={15} aria-hidden="true" />
              <input
                autoComplete="current-password"
                type={secretVisible ? 'text' : 'password'}
                value={secret}
                onChange={(event) => {
                  setError('');
                  setSecret(event.target.value);
                }}
                placeholder={secretPlaceholder}
                aria-invalid={Boolean(error)}
              />
              <button
                type="button"
                className="account-login-icon-button"
                aria-label={secretVisible ? '隐藏授权码' : '显示授权码'}
                title={secretVisible ? '隐藏授权码' : '显示授权码'}
                disabled={!secret}
                onClick={() => setSecretVisible((current) => !current)}
              >
                {secretVisible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>

          <div className={`account-login-provider${isServerReady ? ' ready' : ''}`}>
            <span>
              <strong>{matchedPreset?.label ?? '自定义邮箱'}</strong>
              <small>{matchedPreset?.hint ?? '可在服务器设置中调整收信与发信地址'}</small>
            </span>
            <button
              type="button"
              className="account-login-disclosure"
              aria-expanded={manualSettingsOpen}
              onClick={() => setManualSettingsOpen((current) => !current)}
            >
              服务器设置
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>

          {manualSettingsOpen && (
            <div className="account-login-manual-settings">
              <label className="account-login-field">
                <span>收信协议</span>
                <select
                  value={form.incoming_protocol}
                  onChange={(event) => onFormChange(accountFormForIncomingProtocol(
                    form,
                    event.target.value as IncomingProtocol,
                  ))}
                >
                  <option value="imap">IMAP</option>
                  <option value="pop3">POP3</option>
                </select>
              </label>
              <label className="account-login-field">
                <span>登录方式</span>
                <select
                  value={form.auth_type}
                  onChange={(event) => onFormChange({
                    ...form,
                    auth_type: event.target.value as AccountCreateInput['auth_type'],
                  })}
                >
                  <option value="password">密码 / 授权码</option>
                  <option value="oauth2">OAuth2 Token</option>
                </select>
              </label>
              <label className="account-login-field">
                <span>收信服务器</span>
                <input
                  value={form.imap_host}
                  onChange={(event) => onFormChange({ ...form, imap_host: event.target.value })}
                  placeholder="imap.example.com:993"
                />
              </label>
              <label className="account-login-field">
                <span>发信服务器</span>
                <input
                  value={form.smtp_host}
                  onChange={(event) => onFormChange({ ...form, smtp_host: event.target.value })}
                  placeholder="smtp.example.com:465"
                />
              </label>
            </div>
          )}

          {error && <p className="account-login-error" role="alert">{error}</p>}

          <button className="account-login-submit" type="submit" disabled={!canSubmit || submitting}>
            {submitting ? <LoaderCircle className="account-login-spinner" size={16} /> : <Mail size={16} />}
            <span>{submitting ? submittingStage || '正在登录' : '登录并同步'}</span>
          </button>
        </form>

        <footer>
          <ShieldCheck size={14} aria-hidden="true" />
          <span>凭据仅保存在此设备</span>
        </footer>
      </section>
    </div>
  );
}
