import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bridge = readFileSync(join(root, 'src/tauriBridge.prod.ts'), 'utf8');
const appRoot = readFileSync(join(root, 'src/app/AppRoot.tsx'), 'utf8');
const composerSource = readFileSync(join(root, 'src/components/ComposerWindow.tsx'), 'utf8');
const composerAppSource = readFileSync(join(root, 'src/components/StandaloneComposerApp.tsx'), 'utf8');
const settingsSource = readFileSync(join(root, 'src/components/settings/SettingsFrame.tsx'), 'utf8');
const settingsAppSource = readFileSync(join(root, 'src/components/StandaloneSettingsApp.tsx'), 'utf8');
const composerCss = readFileSync(join(root, 'src/components/composer/composer-polish.css'), 'utf8');
const settingsCss = readFileSync(join(root, 'src/components/settings/settings-shell.css'), 'utf8');

describe('standalone desktop window chrome contract', () => {
  it('keeps both standalone surfaces on their existing content roots with no duplicate chrome', () => {
    expect(appRoot).not.toContain("import StandaloneWindowFrame from '../components/StandaloneWindowFrame'");
    expect(appRoot).not.toContain('<StandaloneWindowFrame');
    expect(appRoot).toContain('? <StandaloneComposerApp />');
    expect(appRoot).toContain('? <StandaloneSettingsApp />');
  });

  it('provides safe titlebar drag regions for standalone composer and settings windows', () => {
    expect(composerSource).toContain('className="composer-titlebar-drag-region"');
    expect(composerSource).toContain('data-tauri-drag-region');
    expect(settingsSource).toContain('className="settings-titlebar-drag-region"');
    expect(settingsSource).toContain('data-tauri-drag-region');

    expect(composerCss).toContain('.composer-titlebar-drag-region');
    expect(composerCss).toContain('pointer-events: none');
    expect(settingsCss).toContain('.settings-titlebar-drag-region');
    expect(settingsCss).toContain('pointer-events: none');
  });

  it('configures native overlay titlebars and safe traffic-light clearance on macOS', () => {
    expect(bridge).not.toMatch(/titleBarStyle:\s*'visible'/);
    expect(bridge.match(/titleBarStyle:\s*'overlay'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(bridge.match(/hiddenTitle:\s*true/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(bridge.match(/trafficLightPosition:\s*new LogicalPosition\(16,\s*18\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);

    expect(composerCss).toContain("body[data-composer-window-platform='macos']");
    expect(composerCss).toContain('padding-left: 88px');
    expect(settingsCss).toContain("body[data-settings-window-platform='macos']");
    expect(settingsCss).toContain('padding-left: 88px');
  });

  it('preserves native window controls on Windows without macOS styling', () => {
    expect(bridge.match(/decorations:\s*true/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(composerAppSource).not.toContain('setDecorations(false)');
    expect(settingsAppSource).not.toContain('setDecorations(false)');
    expect(composerCss).not.toContain("body[data-composer-window-platform='windows']");
    expect(settingsCss).not.toContain("body[data-settings-window-platform='windows']");
  });

  it('resolves platform from native backend without user-agent guessing', () => {
    expect(composerAppSource).toContain('IPC.GetPlatform');
    expect(composerAppSource).not.toContain('navigator.userAgent');
    expect(settingsAppSource).toContain('IPC.GetPlatform');
    expect(settingsAppSource).not.toContain('navigator.userAgent');
  });
});
