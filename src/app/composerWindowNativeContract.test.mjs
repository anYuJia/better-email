import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bridgeSource = readFileSync(join(repoRoot, 'src/tauriBridge.prod.ts'), 'utf8');
const standaloneSource = readFileSync(
  join(repoRoot, 'src/components/StandaloneComposerApp.tsx'),
  'utf8',
);
const capability = JSON.parse(
  readFileSync(join(repoRoot, 'src-tauri/capabilities/default.json'), 'utf8'),
);

function exportedFunction(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const nextExport = source.indexOf('\nexport ', start + 1);
  return source.slice(start, nextExport < 0 ? source.length : nextExport);
}

describe('standalone composer native-window lifecycle contract', () => {
  it('allows the reusable composer window to hide on the first close request', () => {
    expect(capability.windows).toContain('composer');
    expect(capability.permissions).toContain('core:window:allow-hide');
  });

  it('does not expose the native WebView before the composer reports ready', () => {
    const openComposer = exportedFunction(bridgeSource, 'prodOpenComposerWindow');
    expect(openComposer).toContain('waitForComposerWindowReady(composerWindow)');
    expect(openComposer).not.toContain('focusComposerWindow(composerWindow)');
    expect(openComposer.match(/composerWindow\.emit\(COMPOSER_OPEN_EVENT\)/g)).toHaveLength(2);
  });

  it('prewarms through the same renderer-ready handshake used by explicit opens', () => {
    const prewarmComposer = exportedFunction(bridgeSource, 'prodPrewarmComposerWindow');
    expect(prewarmComposer).toContain('waitForComposerWindowReady(await getComposerWindow())');
  });

  it('does not wait for an animation frame to reveal a hidden native WebView', () => {
    const revealEffectStart = standaloneSource.indexOf('if (!shouldRevealWindow || closingRef.current)');
    expect(revealEffectStart).toBeGreaterThanOrEqual(0);
    const revealEffectEnd = standaloneSource.indexOf(
      '}, [composerFocusRequest, openRequestVersion, shouldRevealWindow]);',
      revealEffectStart,
    );
    expect(revealEffectEnd).toBeGreaterThan(revealEffectStart);
    const revealEffect = standaloneSource.slice(revealEffectStart, revealEffectEnd);

    expect(revealEffect).toContain('showCurrentWindow()');
    expect(revealEffect).not.toContain('window.requestAnimationFrame(');
  });

  it('destroys the composer as a safe fallback if hiding fails', () => {
    const closeComposer = exportedFunction(bridgeSource, 'prodCloseCurrentWindow');
    expect(closeComposer).toContain('await currentWindow.hide()');
    expect(closeComposer).toContain('await currentWindow.destroy()');
  });

  it('prevents every repeated native close while one close is in flight', () => {
    const handlerStart = standaloneSource.indexOf('onCurrentWindowCloseRequested((event) =>');
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    const handlerEnd = standaloneSource.indexOf('});', handlerStart);
    const handler = standaloneSource.slice(handlerStart, handlerEnd);
    expect(handler.indexOf('event.preventDefault()')).toBeGreaterThanOrEqual(0);
    expect(handler.indexOf('event.preventDefault()')).toBeLessThan(
      handler.indexOf('if (closingRef.current) return'),
    );
    expect(handler).toContain('finishNativeClose()');
  });
});
