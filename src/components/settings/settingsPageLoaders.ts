import type { SettingsSectionId } from './settingsNavigation';

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => pending ??= load().catch((error) => { pending = undefined; throw error; });
}

export const settingsPageLoaders = {
  accounts: once(() => import('./AccountConnectionSettings')),
  credentials: once(() => import('./CredentialSecuritySettings')),
  experience: once(() => import('./ExperienceSettings')),
  general: once(() => import('./GeneralSettings')),
  backup: once(() => import('./DataSafetySettings')),
  sync: once(() => import('./SyncOperationsSettings')),
  contacts: once(() => import('./ContactAutomationSettings')),
  rules: once(() => import('./RuleAutomationSettings')),
  tools: once(() => import('./ToolsSettingsPage')),
  ai: once(() => import('./AiServiceSettings')),
  mcp: once(() => import('./McpSettings')),
  templates: once(() => import('./TemplateSettings')),
  about: once(() => import('./AboutSettings')),
};

/** Only warm the section the pointer/keyboard is approaching. No settings or
 * mailbox data is requested; this fetches the code already used by React.lazy. */
export function preloadSettingsSection(section: SettingsSectionId) {
  const key = section === 'providers' || section === 'auth' ? 'accounts'
    : section === 'privacy' || section === 'identities' ? 'experience' : section;
  void settingsPageLoaders[key]().catch(() => undefined);
  if (section === 'auth') void settingsPageLoaders.credentials().catch(() => undefined);
}
