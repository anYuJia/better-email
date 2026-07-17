import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Avatar from './Avatar';

describe('Avatar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders fallback initial in the fixed-size avatar shell when no image src exists', () => {
    render(
      <Avatar
        email="google@example.com"
        name="Google"
        className="message-avatar avatar-tone-1"
        fallbackInitial="G"
      />,
    );

    const shell = screen.getByText('G');
    expect(shell.tagName).toBe('SPAN');
    expect(shell.className).toContain('message-avatar');
    expect(shell.className).toContain('avatar-tone-1');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders an explicit avatar src inside the fixed-size avatar shell instead of sizing the img itself', () => {
    render(
      <Avatar
        email="google@example.com"
        name="Google"
        src="https://example.com/avatar.png"
        className="reader-avatar avatar-tone-2"
        fallbackInitial="G"
      />,
    );

    const img = screen.getByRole('img', { name: 'Google' });
    const shell = img.parentElement;

    expect(shell).not.toBeNull();
    expect(shell?.tagName).toBe('SPAN');
    expect(shell?.className).toContain('reader-avatar');
    expect(shell?.className).toContain('avatar-tone-2');
    expect(img.className).toBe('');
  });

  it('falls back to the initial when an explicit avatar src fails to load', () => {
    render(
      <Avatar
        email="resend@example.com"
        name="Resend"
        src="https://example.com/missing.png"
        className="message-avatar avatar-tone-3"
        fallbackInitial="R"
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Resend' }));

    const shell = screen.getByText('R');
    expect(shell.tagName).toBe('SPAN');
    expect(shell.className).toContain('message-avatar');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
