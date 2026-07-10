import { describe, expect, it } from 'vitest';
import { buildProviderCredentialGuidance } from './providerCredentialGuidance';

describe('buildProviderCredentialGuidance', () => {
  it('explains that NetEase requires a client authorization code', () => {
    const guidance = buildProviderCredentialGuidance({
      provider: 'netease',
      auth_type: 'password',
    });

    expect(guidance.providerLabel).toBe('网易 163');
    expect(guidance.credentialLabel).toBe('客户端授权码');
    expect(guidance.title).toContain('不是网页登录密码');
    expect(guidance.verificationHint).toContain('重新生成');
  });

  it('keeps QQ authorization-code instructions provider specific', () => {
    const guidance = buildProviderCredentialGuidance({
      provider: 'qq',
      auth_type: 'password',
    });

    expect(guidance.providerLabel).toBe('QQ 邮箱');
    expect(guidance.placeholder).toContain('QQ 邮箱');
    expect(guidance.checklist).toContain('验证只登录，不发送邮件');
  });

  it('uses OAuth2 guidance whenever the account authentication mode requires it', () => {
    const guidance = buildProviderCredentialGuidance({
      provider: 'gmail',
      auth_type: 'oauth2',
    });

    expect(guidance.providerLabel).toBe('Gmail');
    expect(guidance.credentialLabel).toBe('OAuth2 Token');
    expect(guidance.verificationHint).toContain('OAuth2 授权');
  });

  it('falls back to an application-password workflow for custom providers', () => {
    const guidance = buildProviderCredentialGuidance({
      provider: 'custom',
      auth_type: 'password',
    });

    expect(guidance.providerLabel).toBe('自定义邮箱');
    expect(guidance.credentialLabel).toContain('应用专用密码');
    expect(guidance.summary).toContain('避免直接保存主账号密码');
  });
});
