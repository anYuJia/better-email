import { describe, expect, it } from 'vitest';
import {
  getSettingsNavigationContext,
  settingsNavigationGroups,
  settingsNavigationItems,
  type SettingsSectionId,
} from './settingsNavigation';

describe('settingsNavigation controls and fallback', () => {
  it('does not include providers or auth in sidebar navigation groups', () => {
    const sectionIds = settingsNavigationGroups.flatMap((group) => group.items.map((item) => item.id));
    expect(sectionIds).not.toContain('providers');
    expect(sectionIds).not.toContain('auth');
    expect(sectionIds).toContain('accounts');
  });

  it('updates accounts description', () => {
    const accountsItem = settingsNavigationItems.find((item) => item.id === 'accounts');
    expect(accountsItem?.description).toBe('管理邮箱账号、连接设置和登录方式');
  });

  it('falls back legacy provider section ID to accounts navigation context', () => {
    const context = getSettingsNavigationContext('providers' as SettingsSectionId);
    expect(context.item.id).toBe('accounts');
    expect(context.group.label).toBe('账号与连接');
  });

  it('falls back legacy auth section ID to accounts navigation context', () => {
    const context = getSettingsNavigationContext('auth' as SettingsSectionId);
    expect(context.item.id).toBe('accounts');
    expect(context.group.label).toBe('账号与连接');
  });

  it('matches search keywords like 服务商, 认证, OAuth, 密码 for accounts item', () => {
    const accountsItem = settingsNavigationItems.find((item) => item.id === 'accounts');
    expect(accountsItem?.keywords).toContain('服务商');
    expect(accountsItem?.keywords).toContain('认证');
    expect(accountsItem?.keywords).toContain('oauth');
    expect(accountsItem?.keywords).toContain('密码');
  });

  it('groups sending and notifications under 使用偏好', () => {
    const group = settingsNavigationGroups.find((candidate) => candidate.label === '使用偏好');
    expect(group?.items.map((item) => item.id)).toEqual(['sending', 'notifications']);
  });

  it('groups privacy and identities under 安全与隐私', () => {
    const group = settingsNavigationGroups.find((candidate) => candidate.label === '安全与隐私');
    expect(group).toBeDefined();
    const ids = group!.items.map((item) => item.id);
    expect(ids).toContain('privacy');
    expect(ids).toContain('identities');
  });

  it('groups ai and templates under 智能与效率', () => {
    const group = settingsNavigationGroups.find((candidate) => candidate.label === '智能与效率');
    expect(group?.items.map((item) => item.id)).toEqual(['ai', 'templates']);
  });

  it('groups backup, sync, contacts and rules under 数据与规则', () => {
    const group = settingsNavigationGroups.find((candidate) => candidate.label === '数据与规则');
    const ids = group?.items.map((item) => item.id) ?? [];
    expect(ids).toContain('backup');
    expect(ids).toContain('sync');
    expect(ids).toContain('contacts');
    expect(ids).toContain('rules');
  });

  it('no longer mixes ai and templates into a 使用与隐私 group', () => {
    expect(settingsNavigationGroups.find((candidate) => candidate.label === '使用与隐私')).toBeUndefined();
    const aiItem = settingsNavigationItems.find((item) => item.id === 'ai');
    const templatesItem = settingsNavigationItems.find((item) => item.id === 'templates');
    expect(aiItem?.groupLabel).toBe('智能与效率');
    expect(templatesItem?.groupLabel).toBe('智能与效率');
    expect(settingsNavigationItems.find((item) => item.id === 'sending')?.groupLabel).toBe('使用偏好');
    expect(settingsNavigationItems.find((item) => item.id === 'notifications')?.groupLabel).toBe('使用偏好');
    expect(settingsNavigationItems.find((item) => item.id === 'privacy')?.groupLabel).toBe('安全与隐私');
    expect(settingsNavigationItems.find((item) => item.id === 'identities')?.groupLabel).toBe('安全与隐私');
  });
});
