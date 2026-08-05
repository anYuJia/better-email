import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Avatar, { inferredAvatarCandidates, isValidAvatarUrl } from './Avatar';

describe('Avatar', () => {
  afterEach(() => {
    cleanup();
  });

  describe('isValidAvatarUrl', () => {
    it('accepts http/https URLs', () => {
      expect(isValidAvatarUrl('https://example.com/avatar.png')).toBe(true);
      expect(isValidAvatarUrl('http://example.com/avatar.png')).toBe(true);
    });

    it('rejects empty, invalid, and non-http schemes', () => {
      expect(isValidAvatarUrl('')).toBe(false);
      expect(isValidAvatarUrl('not-a-url')).toBe(false);
      expect(isValidAvatarUrl('ftp://example.com/avatar.png')).toBe(false);
      expect(isValidAvatarUrl('mailto:a@b.com')).toBe(false);
    });
  });

  describe('inferredAvatarCandidates', () => {
    it('only infers avatars for known service domains to avoid generic placeholders', () => {
      expect(inferredAvatarCandidates('daisy@example.com', 'Daisy Priya')).toEqual([]);
      expect(inferredAvatarCandidates('pageupdates@facebookmail.com', 'Facebook 公共主页')).toEqual([
        'https://unavatar.io/facebook.com?fallback=false',
      ]);
      expect(inferredAvatarCandidates('daisy@example.com', 'Daisy Priya').join('\n')).not.toContain('google.com/s2/favicons');
    });
  });

  it('renders an explicit avatar src inside the fixed-size avatar shell', () => {
    render(
      <Avatar
        email="google@example.com"
        name="Google"
        src="https://example.com/avatar.png"
        className="reader-avatar avatar-tone-2"
      />,
    );

    const img = screen.getByRole('img', { name: 'Google' });
    const shell = img.parentElement;

    expect(shell).not.toBeNull();
    expect(shell?.tagName).toBe('SPAN');
    expect(shell?.className).toContain('reader-avatar');
    expect(shell?.className).toContain('avatar-tone-2');
    expect(img.getAttribute('src')).toBe('https://example.com/avatar.png');
    expect(screen.queryByText('G')).toBeNull();
  });

  it('renders the initial text avatar instead of an image when no avatar URL exists', () => {
    render(
      <Avatar
        email="unknown@example.com"
        name="Google"
        className="message-avatar avatar-tone-1"
      />,
    );

    const shell = screen.getByText('G');
    expect(shell.tagName).toBe('SPAN');
    expect(shell.className).toContain('message-avatar');
    expect(shell.className).toContain('avatar-tone-1');
    expect(shell.className).toContain('avatar-initial');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('never requests an image for an invalid avatar URL', () => {
    render(
      <Avatar
        email="google@example.com"
        name="Google"
        src="not-a-valid-url"
        className="message-avatar avatar-tone-1"
      />,
    );

    const shell = screen.getByText('G');
    expect(shell.tagName).toBe('SPAN');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('falls back to the initial text avatar when an avatar src fails to load', () => {
    render(
      <Avatar
        email="resend@example.com"
        name="Resend"
        src="https://example.com/missing.png"
        className="message-avatar avatar-tone-3"
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Resend' }));

    const shell = screen.getByText('R');
    expect(shell.tagName).toBe('SPAN');
    expect(shell.className).toContain('message-avatar');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('skips tiny placeholder images and falls back after inferred candidates fail', () => {
    render(
      <Avatar
        email="notify@github.com"
        name="GitHub"
        className="message-avatar avatar-tone-3"
      />,
    );

    for (let index = 0; index < 2; index += 1) {
      const img = screen.getByRole('img', { name: 'GitHub' }) as HTMLImageElement;
      Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 16 });
      Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 16 });
      fireEvent.load(img);
    }

    expect(screen.getByText('G')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('retries a new avatar src after a previous one failed', () => {
    const { rerender } = render(
      <Avatar
        email="resend@example.com"
        name="Resend"
        src="https://example.com/missing.png"
        className="message-avatar avatar-tone-3"
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Resend' }));
    expect(screen.getByText('R')).not.toBeNull();

    rerender(
      <Avatar
        email="resend@example.com"
        name="Resend"
        src="https://example.com/works.png"
        className="message-avatar avatar-tone-3"
      />,
    );

    expect(screen.getByRole('img', { name: 'Resend' }).getAttribute('src')).toBe(
      'https://example.com/works.png',
    );
  });

  it('shows the first character of a Chinese name', () => {
    render(
      <Avatar
        email="zhang@example.com"
        name="张健"
        className="message-avatar avatar-tone-4"
      />,
    );

    expect(screen.getByText('张')).not.toBeNull();
    expect(screen.queryByText('健')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the uppercase first letter of an English name', () => {
    render(
      <Avatar
        email="anan@example.com"
        name="anan"
        className="message-avatar avatar-tone-5"
      />,
    );

    expect(screen.getByText('A')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('falls back to the uppercase email prefix when the name is empty', () => {
    render(
      <Avatar
        email="bob@example.com"
        name=""
        className="message-avatar avatar-tone-1"
      />,
    );

    expect(screen.getByText('B')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('falls back to "?" when name and email are both empty', () => {
    render(
      <Avatar
        email=""
        name=""
        className="message-avatar avatar-tone-1"
      />,
    );

    expect(screen.getByText('?')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('honors an explicit fallbackInitial override when provided', () => {
    render(
      <Avatar
        email="unknown@example.com"
        name="Google"
        className="message-avatar avatar-tone-1"
        fallbackInitial="X"
      />,
    );

    expect(screen.getByText('X')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
