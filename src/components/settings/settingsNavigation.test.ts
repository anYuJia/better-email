import { describe, expect, it } from 'vitest';
import {
  getSettingsNavigationContext,
  getSettingsDetailItems,
  getSettingsSectionPresentation,
  resolveSettingsNavigationSectionId,
  settingsAccountDetailItems,
  settingsNavigationGroups,
  settingsNavigationItems,
  settingsToolDetailItems,
  type SettingsSectionId,
} from './settingsNavigation';

describe('settingsNavigation information architecture', () => {
  it('places technical account destinations behind the account hub', () => {
    expect(settingsAccountDetailItems.map((item) => item.id)).toEqual([
      'providers',
      'auth',
      'identities',
      'sync',
      'privacy',
    ]);

    for (const section of ['providers', 'auth', 'identities', 'sync', 'privacy'] as SettingsSectionId[]) {
      expect(resolveSettingsNavigationSectionId(section)).toBe('accounts');
      expect(getSettingsNavigationContext(section).item.id).toBe('accounts');
    }
    expect(getSettingsDetailItems('accounts')).toEqual(settingsAccountDetailItems);
  });

  it('uses the same seven top-level destinations on desktop and mobile', () => {
    expect(settingsNavigationGroups.find((group) => group.label === '偏好')?.items.map((item) => item.id))
      .toEqual(['general', 'accounts']);
    expect(settingsNavigationGroups.find((group) => group.label === '智能与集成')?.items.map((item) => item.id))
      .toEqual(['ai', 'mcp']);
    expect(settingsNavigationGroups.find((group) => group.label === '工具与数据')?.items.map((item) => item.id))
      .toEqual(['tools', 'backup']);
    expect(settingsNavigationGroups.find((group) => group.label === '支持')?.items.map((item) => item.id))
      .toEqual(['about']);
    expect(settingsNavigationItems).toHaveLength(7);
  });

  it('removes the developer security preview destination', () => {
    expect(settingsNavigationGroups.some((group) => group.label === '开发者工具')).toBe(false);
    expect(settingsNavigationItems.some((item) => item.id === ('security-preview' as SettingsSectionId))).toBe(false);
  });

  it('uses explicit labels for the consolidated destinations', () => {
    expect(getSettingsSectionPresentation('general').label).toBe('通用');
    expect(getSettingsSectionPresentation('accounts').label).toBe('邮箱账号');
    expect(getSettingsSectionPresentation('identities').label).toBe('发件身份与标签');
  });

  it('places contact template and automation management behind one tools hub', () => {
    expect(settingsToolDetailItems.map((item) => item.id)).toEqual(['contacts', 'templates', 'rules']);
    for (const section of settingsToolDetailItems.map((item) => item.id)) {
      expect(resolveSettingsNavigationSectionId(section)).toBe('tools');
      expect(getSettingsNavigationContext(section).item.id).toBe('tools');
    }
    expect(getSettingsDetailItems('tools')).toEqual(settingsToolDetailItems);
  });

  it('keeps AI and MCP as independent destinations', () => {
    const visible = settingsNavigationItems.map((item) => item.id);
    expect(visible).toContain('ai');
    expect(visible).toContain('mcp');
    expect(resolveSettingsNavigationSectionId('ai')).toBe('ai');
    expect(resolveSettingsNavigationSectionId('mcp')).toBe('mcp');
  });

  it('consolidates appearance sending and notifications into general', () => {
    expect(getSettingsNavigationContext('general').item.label).toBe('通用');
    expect(getSettingsSectionPresentation('general').description).toContain('发送');
  });

  it('keeps data and storage as the broad storage destination', () => {
    const backup = settingsNavigationItems.find((item) => item.id === 'backup');
    expect(backup?.label).toBe('数据与存储');
    expect(getSettingsSectionPresentation('backup').description).toContain('附件缓存');
  });
});
