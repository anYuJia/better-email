import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AnimatedDisclosure from './AnimatedDisclosure';

describe('AnimatedDisclosure', () => {
  afterEach(cleanup);

  it('opens, closes and reverses without unmounting its content', () => {
    const { container } = render(
      <AnimatedDisclosure summary="高级设置">
        <input aria-label="服务器地址" />
      </AnimatedDisclosure>,
    );

    const disclosure = container.querySelector('.settings-animated-disclosure')!;
    const trigger = screen.getByRole('button', { name: /高级设置/ });
    const region = container.querySelector('.settings-animated-disclosure-region')!;
    const input = screen.getByRole('textbox', { name: '服务器地址', hidden: true });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(region.getAttribute('aria-hidden')).toBe('true');
    expect(region.hasAttribute('inert')).toBe(true);

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure.classList.contains('is-open')).toBe(true);
    expect(region.getAttribute('aria-hidden')).toBe('false');
    expect(region.hasAttribute('inert')).toBe(false);

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('textbox', { name: '服务器地址' })).toBe(input);
  });
});
