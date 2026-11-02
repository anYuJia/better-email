import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertContained, assertHeaderLayout } from './ui-header-layout.mjs';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
function fixture() {
  return {
    search: rect(0, 0, 400, 38), input: rect(30, 0, 240, 36), hint: { hidden: true },
    fields: [{ name: 'icon', rect: rect(5, 10, 18, 18) }, { name: 'input', rect: rect(30, 0, 240, 36) },
      { name: 'scope', rect: rect(280, 4, 70, 28) }],
    header: rect(0, 54, 320, 90), pane: rect(0, 54, 320, 700),
    controls: [{ name: 'sort', rect: rect(180, 102, 130, 32), hit: true, clientWidth: 130, scrollWidth: 130 }],
    documentWidth: 1024, viewportWidth: 1024,
  };
}

describe('fresh-boot responsive header contracts', () => {
  it('loads the shared accessibility utility before lazy composer styles', () => {
    const css = readFileSync('src/styles/global.css', 'utf8');
    const rule = css.match(/\.sr-only\s*\{([^}]+)\}/)?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/);
    expect(readFileSync('src/components/composer/composer.css', 'utf8')).not.toMatch(/^\.sr-only\s*\{/m);
    expect(readFileSync('src/ui-2026.css', 'utf8')).toContain("@import './styles/global.css'");
  });
  it('accepts a multi-row header with all essential actions contained', () => {
    expect(() => assertHeaderLayout(fixture())).not.toThrow();
  });
  it.each(['visible hint', 'collapsed input', 'overlap', 'clipped sort', 'hidden text', 'covered sort', 'workspace overflow'])(
    'rejects the %s regression', (failure) => {
      const snapshot = fixture();
      if (failure === 'visible hint') snapshot.hint.hidden = false;
      if (failure === 'collapsed input') snapshot.input.width = 1;
      if (failure === 'overlap') snapshot.fields[2].rect = rect(250, 4, 70, 28);
      if (failure === 'clipped sort') snapshot.controls[0].rect = rect(280, 102, 130, 32);
      if (failure === 'hidden text') snapshot.controls[0].scrollWidth = 200;
      if (failure === 'covered sort') snapshot.controls[0].hit = false;
      if (failure === 'workspace overflow') snapshot.documentWidth = 1200;
      expect(() => assertHeaderLayout(snapshot)).toThrow();
    },
  );
  it('rejects a header control hidden below a fixed-height parent', () => {
    expect(() => assertContained(rect(0, 0, 320, 52), rect(180, 45, 130, 32), 'sort')).toThrow();
  });
});
