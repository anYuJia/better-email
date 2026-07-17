import { describe, expect, it } from 'vitest';
import {
  accountConnectionSettingsSnapshot,
  accountConnectionSettingsEqual,
  isAccountConnectionDirty,
  authTypeChangeMessage,
  deriveSaveAndVerifyOverall,
  emptySaveAndVerifyReport,
  saveAndVerifySummary,
  updateSaveAndVerifyReportStage,
  userFacingVerifyMessage,
  resolveOrdinaryProviderOption,
  isCustomProvider,
} from './accountConnectionSettings';

describe('accountConnectionSettings pure functions', () => {
  const baseAccount = {
    id: 1,
    email: 'test@example.com',
    display_name: 'Test User',
    provider: 'gmail',
    imap_host: 'imap.gmail.com:993',
    smtp_host: 'smtp.gmail.com:587',
    incoming_protocol: 'imap' as const,
    auth_type: 'oauth2' as const,
    sync_mode: 'push' as const,
    remote_images_allowed: true,
    signature: '--\nTest',
    is_default: true,
  };

  it('snapshot extracts the nine connection fields', () => {
    const snapshot = accountConnectionSettingsSnapshot(baseAccount);
    expect(snapshot).toEqual({
      display_name: 'Test User',
      provider: 'gmail',
      imap_host: 'imap.gmail.com:993',
      smtp_host: 'smtp.gmail.com:587',
      incoming_protocol: 'imap',
      auth_type: 'oauth2',
      sync_mode: 'push',
      remote_images_allowed: true,
      signature: '--\nTest',
    });
  });

  it('equal returns true for identical connection settings', () => {
    const a = { ...baseAccount };
    const b = { ...baseAccount };
    expect(accountConnectionSettingsEqual(a, b)).toBe(true);
  });

  it('equal returns true for same connection settings but different email/id', () => {
    const a = { ...baseAccount, id: 1, email: 'a@b.com' };
    const b = { ...baseAccount, id: 2, email: 'c@d.com' };
    expect(accountConnectionSettingsEqual(a, b)).toBe(true);
  });

  it('equal returns false when provider differs', () => {
    const a = { ...baseAccount, provider: 'gmail' };
    const b = { ...baseAccount, provider: 'outlook' };
    expect(accountConnectionSettingsEqual(a, b)).toBe(false);
  });

  it('equal returns false when auth_type differs', () => {
    const a = { ...baseAccount, auth_type: 'password' };
    const b = { ...baseAccount, auth_type: 'oauth2' };
    expect(accountConnectionSettingsEqual(a, b)).toBe(false);
  });

  it('equal returns false when imap_host differs', () => {
    const a = { ...baseAccount, imap_host: 'imap.gmail.com:993' };
    const b = { ...baseAccount, imap_host: 'imap.example.com:993' };
    expect(accountConnectionSettingsEqual(a, b)).toBe(false);
  });

  it('equal returns false when any other connection field differs', () => {
    const a = { ...baseAccount, sync_mode: 'manual' };
    const b = { ...baseAccount, sync_mode: '15min' };
    expect(accountConnectionSettingsEqual(a, b)).toBe(false);
  });

  it('equal handles null/undefined correctly', () => {
    expect(accountConnectionSettingsEqual(null, null)).toBe(true);
    expect(accountConnectionSettingsEqual(undefined, undefined)).toBe(true);
    expect(accountConnectionSettingsEqual(null, baseAccount)).toBe(false);
    expect(accountConnectionSettingsEqual(baseAccount, null)).toBe(false);
  });

  it('isAccountConnectionDirty returns false when persisted and draft are identical', () => {
    expect(isAccountConnectionDirty(baseAccount, baseAccount)).toBe(false);
  });

  it('isAccountConnectionDirty returns true when provider changed', () => {
    expect(isAccountConnectionDirty(baseAccount, { ...baseAccount, provider: 'outlook' })).toBe(true);
  });

  it('isAccountConnectionDirty returns true when auth_type changed', () => {
    expect(isAccountConnectionDirty(baseAccount, { ...baseAccount, auth_type: 'password' })).toBe(true);
  });

  it('isAccountConnectionDirty returns true when host changed', () => {
    expect(isAccountConnectionDirty(baseAccount, { ...baseAccount, imap_host: 'imap.other.com:993' })).toBe(true);
  });

  it('isAccountConnectionDirty returns false when id differs (different account)', () => {
    const a = { ...baseAccount, id: 1 };
    const b = { ...baseAccount, id: 2 };
    expect(isAccountConnectionDirty(a, b)).toBe(false);
  });

  it('isAccountConnectionDirty handles null gracefully', () => {
    expect(isAccountConnectionDirty(null, baseAccount)).toBe(false);
    expect(isAccountConnectionDirty(baseAccount, null)).toBe(false);
    expect(isAccountConnectionDirty(null, null)).toBe(false);
  });

  describe('authTypeChangeMessage', () => {
    it('returns null when auth_type unchanged', () => {
      expect(authTypeChangeMessage('password', 'password')).toBeNull();
      expect(authTypeChangeMessage('oauth2', 'oauth2')).toBeNull();
    });

    it('returns message when password -> oauth2', () => {
      const msg = authTypeChangeMessage('password', 'oauth2');
      expect(msg).toContain('OAuth2');
      expect(msg).toContain('重新');
    });

    it('returns message when oauth2 -> password', () => {
      const msg = authTypeChangeMessage('oauth2', 'password');
      expect(msg).toContain('授权码');
      expect(msg).toContain('重新');
    });

    it('returns generic message for other changes', () => {
      const msg = authTypeChangeMessage('password', 'custom');
      expect(msg).toContain('认证方式已修改');
    });

    it('handles null/undefined gracefully', () => {
      expect(authTypeChangeMessage(null, 'password')).toBeNull();
      expect(authTypeChangeMessage('password', null)).toBeNull();
    });
  });

  describe('userFacingVerifyMessage', () => {
    it('shows auth change message when authTypeChanged is true', () => {
      expect(userFacingVerifyMessage({
        serverOk: true,
        credentialExists: true,
        incomingOk: true,
        smtpOk: true,
        authType: 'oauth2',
        authTypeChanged: true,
      })).toContain('OAuth2');

      expect(userFacingVerifyMessage({
        serverOk: true,
        credentialExists: true,
        incomingOk: true,
        smtpOk: true,
        authType: 'password',
        authTypeChanged: true,
      })).toContain('授权码');
    });

    it('shows password-specific guidance when no credential is stored', () => {
      expect(userFacingVerifyMessage({
        serverOk: true,
        credentialExists: false,
        incomingOk: null,
        smtpOk: null,
        authType: 'password',
        authTypeChanged: false,
      })).toContain('授权码');
    });

    it('shows incoming ok but smtp failed', () => {
      expect(userFacingVerifyMessage({
        serverOk: true,
        credentialExists: true,
        incomingOk: true,
        smtpOk: false,
        authType: 'password',
        authTypeChanged: false,
      })).toContain('收信认证成功');
      expect(userFacingVerifyMessage({
        serverOk: true,
        credentialExists: true,
        incomingOk: true,
        smtpOk: false,
        authType: 'password',
        authTypeChanged: false,
      })).toContain('发信认证失败');
    });

    it('shows smtp ok but incoming failed', () => {
      expect(userFacingVerifyMessage({
        serverOk: true,
        credentialExists: true,
        incomingOk: false,
        smtpOk: true,
        authType: 'password',
        authTypeChanged: false,
      })).toContain('发信认证成功');
      expect(userFacingVerifyMessage({
        serverOk: true,
        credentialExists: true,
        incomingOk: false,
        smtpOk: true,
        authType: 'password',
        authTypeChanged: false,
      })).toContain('收信认证失败');
    });

    it('shows both ok', () => {
      expect(userFacingVerifyMessage({
        serverOk: true,
        credentialExists: true,
        incomingOk: true,
        smtpOk: true,
        authType: 'password',
        authTypeChanged: false,
      })).toContain('均已通过');
    });

    it('shows server failed', () => {
      expect(userFacingVerifyMessage({
        serverOk: false,
        credentialExists: true,
        incomingOk: null,
        smtpOk: null,
        authType: 'password',
        authTypeChanged: false,
      })).toContain('服务器连接失败');
    });

    it('shows no credential for oauth2', () => {
      expect(userFacingVerifyMessage({
        serverOk: true,
        credentialExists: false,
        incomingOk: null,
        smtpOk: null,
        authType: 'oauth2',
        authTypeChanged: false,
      })).toContain('OAuth2 Token');
    });
  });

  describe('save and verify stage derivation', () => {
    it('derives overall status using error and authentication priority', () => {
      const report = emptySaveAndVerifyReport();
      expect(deriveSaveAndVerifyOverall(report.stages)).toBe('pending');
      expect(deriveSaveAndVerifyOverall(report.stages.map((stage) => (
        stage.id === 'save' ? { ...stage, state: 'running' as const } : stage
      )))).toBe('running');
      expect(deriveSaveAndVerifyOverall(report.stages.map((stage) => (
        stage.id === 'credential' ? { ...stage, state: 'needs_auth' as const } : stage
      )))).toBe('needs_auth');
      expect(deriveSaveAndVerifyOverall(report.stages.map((stage) => (
        stage.id === 'smtp' ? { ...stage, state: 'error' as const } : stage
      )))).toBe('error');
    });

    it('uses the newly updated stage when deriving the report summary', () => {
      const initial = emptySaveAndVerifyReport();
      const withServer = updateSaveAndVerifyReportStage(
        initial,
        'server',
        'success',
        '服务器可连接',
        { authType: 'password', authTypeChanged: false },
      );
      const withCredential = updateSaveAndVerifyReportStage(
        withServer,
        'credential',
        'needs_auth',
        '未保存授权码',
        { authType: 'password', authTypeChanged: false },
      );

      expect(withCredential.summary).toContain('授权码');
      expect(withCredential.overall).toBe('needs_auth');
    });

    it('derives partial authentication summaries from current stages', () => {
      const report = emptySaveAndVerifyReport();
      const stages = report.stages.map((stage) => {
        if (stage.id === 'incoming') return { ...stage, state: 'success' as const };
        if (stage.id === 'smtp') return { ...stage, state: 'error' as const };
        return stage;
      });
      expect(saveAndVerifySummary(stages, 'password', false)).toContain('收信认证成功');
    });
  });

  describe('resolveOrdinaryProviderOption', () => {
    it('maps known providers', () => {
      expect(resolveOrdinaryProviderOption('gmail')).toBe('gmail');
      expect(resolveOrdinaryProviderOption('Gmail')).toBe('gmail');
      expect(resolveOrdinaryProviderOption('google')).toBe('gmail');
      expect(resolveOrdinaryProviderOption('outlook')).toBe('outlook');
      expect(resolveOrdinaryProviderOption('office365')).toBe('outlook');
      expect(resolveOrdinaryProviderOption('microsoft')).toBe('outlook');
      expect(resolveOrdinaryProviderOption('qq')).toBe('qq');
      expect(resolveOrdinaryProviderOption('netease')).toBe('netease');
      expect(resolveOrdinaryProviderOption('163')).toBe('netease');
    });

    it('defaults to custom for unknown', () => {
      expect(resolveOrdinaryProviderOption('custom')).toBe('custom');
      expect(resolveOrdinaryProviderOption('mycompany')).toBe('custom');
      expect(resolveOrdinaryProviderOption('')).toBe('custom');
    });
  });

  describe('isCustomProvider', () => {
    it('returns true for custom', () => {
      expect(isCustomProvider('custom')).toBe(true);
      expect(isCustomProvider('mycompany')).toBe(true);
    });

    it('returns false for known providers', () => {
      expect(isCustomProvider('gmail')).toBe(false);
      expect(isCustomProvider('outlook')).toBe(false);
      expect(isCustomProvider('qq')).toBe(false);
      expect(isCustomProvider('netease')).toBe(false);
    });
  });
});
