import { describe, expect, it } from 'vitest';
import {
  getSettingsNavigationContext,
  getSettingsSectionPresentation,
  resolveSettingsNavigationSectionId,
  settingsNavigationGroups,
  settingsNavigationItems,
  type SettingsSectionId,
} from './settingsNavigation';

describe('settingsNavigation v3 information architecture', () => {
  it('keeps account-specific pages out of the top-level sidebar', () => {
    const sectionIds = settingsNavigationGroups.flatMap((group) => group.items.map((item) => item.id));
    expect(sectionIds).toContain('accounts');
    expect(sectionIds).not.toContain('providers');
    expect(sectionIds).not.toContain('auth');
    expect(sectionIds).not.toContain('identities');
    expect(sectionIds).not.toContain('sync');
    expect(sectionIds).not.toContain('privacy');
  });

  it('maps all account-specific pages back to the account navigation context', () => {
    for (const section of ['providers', 'auth', 'identities', 'sync', 'privacy'] as SettingsSectionId[]) {
      expect(resolveSettingsNavigationSectionId(section)).toBe('accounts');
      expect(getSettingsNavigationContext(section).item.id).toBe('accounts');
    }
  });

  it('keeps sending directly reachable while preserving its own page title', () => {
    expect(resolveSettingsNavigationSectionId('sending')).toBe('sending');
    expect(getSettingsNavigationContext('sending').item.label).toBe('发送');
    expect(getSettingsSectionPresentation('sending').label).toBe('发送');
  });

  it('uses a compact top-level information architecture', () => {
    const visible = settingsNavigationItems.map((item) => item.id);
    expect(visible).toContain('appearance');
    expect(visible).toContain('accounts');
    expect(visible).toContain('notifications');
    expect(visible).toContain('ai');
    expect(visible).toContain('backup');
    expect(visible).toContain('contacts');
    expect(visible).toContain('templates');
    expect(visible).toContain('rules');
    expect(visible).toContain('about');
  });

  it('puts the core destinations into deliberate groups', () => {
    expect(settingsNavigationGroups.find((group) => group.label === '常用')?.items.map((item) => item.id))
      .toEqual(['appearance', 'accounts', 'sending', 'notifications']);
    expect(settingsNavigationGroups.find((group) => group.label === '智能')?.items.map((item) => item.id))
      .toEqual(['ai']);
    expect(settingsNavigationGroups.find((group) => group.label === '效率工具')?.items.map((item) => item.id))
      .toEqual(['contacts', 'templates', 'rules']);
  });

  it('makes account search discover nested settings from the single account entry', () => {
    const accountsItem = settingsNavigationItems.find((item) => item.id === 'accounts');
    expect(accountsItem?.keywords).toContain('服务商');
    expect(accountsItem?.keywords).toContain('oauth');
    expect(accountsItem?.keywords).toContain('同步');
    expect(accountsItem?.keywords).toContain('签名');
    expect(accountsItem?.keywords).toContain('隐私');
  });

  it('renames backup to a broader data and storage destination', () => {
    const backup = settingsNavigationItems.find((item) => item.id === 'backup');
    expect(backup?.label).toBe('数据与存储');
    expect(getSettingsSectionPresentation('backup').description).toContain('附件缓存');
  });
});
