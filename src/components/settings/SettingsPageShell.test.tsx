import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SettingsPageShell from './SettingsPageShell';
import { getSettingsNavigationContext, type SettingsSectionId } from './settingsNavigation';

afterEach(cleanup);

function page(section: SettingsSectionId, value = '') {
  const { group, item } = getSettingsNavigationContext(section);
  return <SettingsPageShell activeSection={section} group={group} item={item}>
    <input aria-label="设置输入" value={value} readOnly />
  </SettingsPageShell>;
}

describe('SettingsPageShell navigation motion', () => {
  it('keeps one reveal identity while form values rerender', () => {
    const { container, rerender } = render(page('general'));
    rerender(page('about'));
    const node = container.querySelector('[data-settings-page]');
    expect(node?.getAttribute('data-page-motion')).toBe('lateral');
    rerender(page('about', '输入更新'));
    expect(container.querySelector('[data-settings-page]')).toBe(node);
    expect(node?.getAttribute('data-page-motion')).toBe('lateral');
  });

  it('keeps the heading surface stable through immediate successive navigation', () => {
    const { container, rerender } = render(page('accounts'));
    rerender(page('providers'));
    const forward = container.querySelector('[data-settings-page]');
    expect(forward?.getAttribute('data-page-motion')).toBe('forward');
    rerender(page('accounts'));
    const backward = container.querySelector('[data-settings-page]');
    expect(backward).toBe(forward);
    expect(backward?.getAttribute('data-page-motion')).toBe('backward');
  });
});
