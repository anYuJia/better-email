import { describe, expect, it } from 'vitest';
import {
  devMode,
  getSettingsNavigationContext,
  getSettingsSectionPresentation,
  resolveSettingsNavigationSectionId,
  settingsNavigationGroups,
  settingsNavigationItems,
  type SettingsSectionId,
} from './settingsNavigation';

describe('settingsNavigation information architecture', () => {
  it('keeps every account destination directly reachable', () => {
    const accountGroup = settingsNavigationGroups.find((group) => group.label === '账户');
    expect(accountGroup?.items.map((item) => item.id)).toEqual([
      'accounts',
      'providers',
      'auth',
      'identities',
      'sync',
      'privacy',
    ]);

    for (const section of ['accounts', 'providers', 'auth', 'identities', 'sync', 'privacy'] as SettingsSectionId[]) {
      expect(resolveSettingsNavigationSectionId(section)).toBe(section);
      expect(getSettingsNavigationContext(section).item.id).toBe(section);
    }
  });

  it('uses the shared desktop and mobile grouping model', () => {
    expect(settingsNavigationGroups.find((group) => group.label === '基础')?.items.map((item) => item.id))
      .toEqual(['appearance', 'sending', 'notifications']);
    expect(settingsNavigationGroups.find((group) => group.label === '智能与集成')?.items.map((item) => item.id))
      .toEqual(['ai', 'mcp']);
    expect(settingsNavigationGroups.find((group) => group.label === '效率工具')?.items.map((item) => item.id))
      .toEqual(['contacts', 'templates', 'rules']);
    expect(settingsNavigationGroups.find((group) => group.label === '数据与应用')?.items.map((item) => item.id))
      .toEqual(['backup', 'about']);
  });

  it('keeps developer-only tools out of normal user groups', () => {
    const developerGroup = settingsNavigationGroups.find((group) => group.label === '开发者工具');
    if (devMode) {
      expect(developerGroup?.items.map((item) => item.id)).toEqual(['security-preview']);
    } else {
      expect(developerGroup).toBeUndefined();
    }
  });

  it('renames generic destinations to explicit user-facing labels', () => {
    expect(getSettingsSectionPresentation('appearance').label).toBe('外观');
    expect(getSettingsSectionPresentation('accounts').label).toBe('邮箱账号');
    expect(getSettingsSectionPresentation('identities').label).toBe('发件身份与标签');
  });

  it('keeps AI and MCP as independent destinations', () => {
    const visible = settingsNavigationItems.map((item) => item.id);
    expect(visible).toContain('ai');
    expect(visible).toContain('mcp');
    expect(resolveSettingsNavigationSectionId('ai')).toBe('ai');
    expect(resolveSettingsNavigationSectionId('mcp')).toBe('mcp');
  });

  it('keeps sending directly reachable with its own page title', () => {
    expect(resolveSettingsNavigationSectionId('sending')).toBe('sending');
    expect(getSettingsNavigationContext('sending').item.label).toBe('发送');
    expect(getSettingsSectionPresentation('sending').label).toBe('发送');
  });

  it('keeps data and storage as the broad storage destination', () => {
    const backup = settingsNavigationItems.find((item) => item.id === 'backup');
    expect(backup?.label).toBe('数据与存储');
    expect(getSettingsSectionPresentation('backup').description).toContain('附件缓存');
  });
});
