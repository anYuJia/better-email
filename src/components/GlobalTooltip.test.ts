import { describe, expect, it } from 'vitest';
import {
  getTooltipText,
  isTextOnlyTooltipButton,
  shouldShowGlobalTooltip,
} from './GlobalTooltip';

function fakeElement({
  tagName = 'BUTTON',
  textContent = '',
  attributes = {},
  classes = [],
  hasSvg = false,
  insideOverlay = false,
}: {
  tagName?: string;
  textContent?: string;
  attributes?: Record<string, string>;
  classes?: string[];
  hasSvg?: boolean;
  insideOverlay?: boolean;
}) {
  const attrs = new Map(Object.entries(attributes));
  const classSet = new Set(classes);

  return {
    tagName,
    textContent,
    classList: {
      add: (className: string) => classSet.add(className),
      contains: (className: string) => classSet.has(className),
    },
    closest: () => (insideOverlay ? {} : null),
    getAttribute: (name: string) => attrs.get(name) ?? null,
    hasAttribute: (name: string) => attrs.has(name),
    querySelector: (selector: string) => (hasSvg && selector === 'svg' ? {} : null),
    removeAttribute: (name: string) => attrs.delete(name),
    setAttribute: (name: string, value: string) => attrs.set(name, value),
  } as unknown as HTMLElement;
}

describe('GlobalTooltip helpers', () => {
  it('prefers native titles before restored title copies and aria labels', () => {
    const button = fakeElement({
      attributes: {
        'aria-label': 'Aria label',
        'data-native-title': 'Restored title',
        title: 'Native title',
      },
    });

    expect(getTooltipText(button)).toBe('Native title');

    button.removeAttribute('title');

    expect(getTooltipText(button)).toBe('Restored title');
  });

  it('suppresses redundant tooltips for ordinary text-only buttons', () => {
    const button = fakeElement({
      textContent: '发送',
      attributes: { title: '发送' },
    });

    expect(isTextOnlyTooltipButton(button)).toBe(true);
    expect(shouldShowGlobalTooltip(button)).toBe(false);

    button.classList.add('primary-action');

    expect(shouldShowGlobalTooltip(button)).toBe(true);
  });

  it('keeps icon-only and disabled controls on the expected paths', () => {
    const iconButton = fakeElement({
      attributes: { 'aria-label': '搜索' },
      hasSvg: true,
    });

    expect(isTextOnlyTooltipButton(iconButton)).toBe(false);
    expect(shouldShowGlobalTooltip(iconButton)).toBe(true);

    iconButton.setAttribute('disabled', '');

    expect(shouldShowGlobalTooltip(iconButton)).toBe(false);
  });

  it('suppresses tooltips inside active overlays', () => {
    const button = fakeElement({
      attributes: { title: '更多操作' },
      hasSvg: true,
      insideOverlay: true,
    });

    expect(shouldShowGlobalTooltip(button)).toBe(false);
  });
});
