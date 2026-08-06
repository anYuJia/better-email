import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import WindowChrome, { detectDesktopPlatform } from './WindowChrome';

describe('WindowChrome', () => {
  afterEach(() => {
    cleanup();
    document.body.className = '';
  });

  it('detects the web platform when no Tauri runtime is present', () => {
    expect(detectDesktopPlatform()).toBe('web');
  });

  it('renders nothing in web / mock mode', () => {
    const { container } = render(<WindowChrome />);
    expect(container.querySelector('.window-chrome')).toBeNull();
    expect(document.body.classList.contains('platform-web')).toBe(false);
  });
});
