import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bridgeSource = readFileSync(join(repoRoot, 'src/tauriBridge.prod.ts'), 'utf8');
const rootSource = readFileSync(join(repoRoot, 'src/app/AppRoot.tsx'), 'utf8');
const standaloneSource = readFileSync(
  join(repoRoot, 'src/components/StandaloneSettingsApp.tsx'),
  'utf8',
);
const appSource = readFileSync(join(repoRoot, 'src/App.tsx'), 'utf8');
const rustAppSource = readFileSync(join(repoRoot, 'src-tauri/src/lib.rs'), 'utf8');
const capability = JSON.parse(
  readFileSync(join(repoRoot, 'src-tauri/capabilities/default.json'), 'utf8'),
);

function exportedFunction(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const nextExport = source.indexOf('\nexport ', start + 1);
  return source.slice(start, nextExport < 0 ? source.length : nextExport);
}

describe('standalone settings native-window lifecycle contract', () => {
  it('grants the reusable settings label access to the desktop capability', () => {
    expect(capability.windows).toContain('settings');
    expect(capability.permissions).toContain('core:webview:allow-create-webview-window');
    expect(capability.permissions).toContain('core:window:allow-destroy');
  });

  it('creates a hidden settings WebView and reveals it only after readiness', () => {
    expect(bridgeSource).toContain("settingsUrl.searchParams.set('window', 'settings')");
    expect(bridgeSource).toContain("settingsUrl.searchParams.set('section', request.section || 'accounts')");
    expect(bridgeSource).toContain("settingsUrl.searchParams.set('scope', String(request.accountScope))");
    expect(bridgeSource).toMatch(/new WebviewWindow\(SETTINGS_WINDOW_LABEL,[\s\S]*?visible: false/);
    expect(bridgeSource).toMatch(/new WebviewWindow\(SETTINGS_WINDOW_LABEL,[\s\S]*?titleBarStyle: 'overlay'/);
    expect(bridgeSource).toMatch(/new WebviewWindow\(SETTINGS_WINDOW_LABEL,[\s\S]*?hiddenTitle: true/);
    expect(bridgeSource).toContain('trafficLightPosition: new LogicalPosition(16, 18)');

    const openSettings = exportedFunction(bridgeSource, 'prodOpenSettingsWindow');
    expect(openSettings).toContain('waitForSettingsWindowReady(settingsWindow)');
    expect(openSettings).toContain('focusComposerWindow(settingsWindow)');
    expect(openSettings.match(/settingsWindow\.emit\(SETTINGS_OPEN_EVENT, request\)/g)).toHaveLength(2);
  });

  it('mounts a dedicated settings renderer instead of mailbox chrome', () => {
    expect(rootSource).toContain('isStandaloneSettingsWindow()');
    expect(rootSource).toContain('<StandaloneSettingsApp />');
    expect(appSource).toContain('{standaloneSettingsWindow ? null : isMobileApp ? (');
    expect(appSource).toContain('standalone={standaloneSettingsWindow}');
  });

  it('routes native close requests into the same dirty-state close flow', () => {
    const handlerStart = standaloneSource.indexOf('onCurrentWindowCloseRequested((event) =>');
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    const handlerEnd = standaloneSource.indexOf('});', handlerStart);
    const handler = standaloneSource.slice(handlerStart, handlerEnd);
    expect(handler).toContain('event.preventDefault()');
    expect(handler).toContain('setNativeCloseRequestVersion');
    expect(rustAppSource).toContain('window.label() == "composer" || window.label() == "settings"');
  });

  it('waits for platform chrome resolution before revealing the renderer', () => {
    expect(standaloneSource).toContain('platformReadyRef.current = true');
    expect(standaloneSource).toContain("body.dataset.settingsWindowPlatform");
    expect(standaloneSource).toMatch(/!platformReadyRef\.current[\s\S]*?!surfaceReadyRef\.current/);
  });

  it('suppresses mailbox bootstrap and automatic background work in settings', () => {
    expect(appSource).toContain('enabled: !standaloneSettingsWindow');
    expect(appSource).toContain('automaticProcessingEnabled: !standaloneSettingsWindow');
    expect(appSource).toContain('useUnreadFocusSync(refreshUnreadIndicators, accountScope, !standaloneSettingsWindow)');
    expect(appSource).toContain('handleMailboxAccountScopeChange');
  });
});
