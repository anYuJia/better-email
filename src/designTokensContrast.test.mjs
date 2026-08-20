import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/design-tokens.css', 'utf8');
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const darkBlock = css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

function variable(block, name) {
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? '';
}

const hues = {
  neutral: Number(variable(rootBlock, 'primitive-hue-neutral')),
  paper: Number(variable(rootBlock, 'primitive-hue-paper')),
  accent: Number(variable(rootBlock, 'primitive-hue-accent')),
};

function parseOklch(block, name) {
  const value = variable(block, name);
  const match = value.match(/oklch\(([\d.]+)\s+([\d.]+)\s+var\(--primitive-hue-(\w+)\)\)/);
  if (!match) throw new Error(`Cannot parse --${name}: ${value}`);
  return [Number(match[1]), Number(match[2]), hues[match[3]]];
}

function luminance([lightness, chroma, hue]) {
  const angle = hue * Math.PI / 180;
  const a = chroma * Math.cos(angle);
  const b = chroma * Math.sin(angle);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const surfaceTokens = [
  'color-canvas',
  'color-surface-sidebar',
  'color-surface-list',
  'color-surface-reader',
  'color-surface-raised',
  'color-surface-muted',
  'color-surface-selected',
];

describe('tertiary text contrast', () => {
  for (const [theme, block] of [['light', rootBlock], ['dark', darkBlock]]) {
    it(`${theme} theme stays AA-readable on every persistent and selected surface`, () => {
      const text = parseOklch(block, 'color-text-tertiary');
      for (const surfaceName of surfaceTokens) {
        const ratio = contrast(text, parseOklch(block, surfaceName));
        expect(ratio, `${theme}: tertiary text on --${surfaceName}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
