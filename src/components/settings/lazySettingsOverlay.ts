import { lazy } from 'react';
import type { SettingsSectionId } from './SettingsFrame';

const loadSettingsOverlay = () => import('./SettingsOverlay');
export const LazySettingsOverlay = lazy(loadSettingsOverlay);

export function preloadSettingsOverlay(section: SettingsSectionId = 'general') {
  void loadSettingsOverlay().then((module) => module.preloadSettingsSection(section)).catch(() => undefined);
}
