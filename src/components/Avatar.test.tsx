import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Avatar from './Avatar';

describe('Avatar', () => {
  it('renders fallback initial in the fixed-size avatar shell when no image candidates exist', () => {
    render(
      <Avatar
        email=""
        name="Google"
        className="message-avatar avatar-tone-1"
        fallbackInitial="G"
      />,
    );

    const shell = screen.getByText('G');
    expect(shell.tagName).toBe('SPAN');
    expect(shell.className).toContain('message-avatar');
    expect(shell.className).toContain('avatar-tone-1');
  });

  it('renders remote images inside the fixed-size avatar shell instead of sizing the img itself', async () => {
    render(
      <Avatar
        email="google@example.com"
        name="Google"
        className="reader-avatar avatar-tone-2"
        fallbackInitial="G"
      />,
    );

    const img = await waitFor(() => screen.getByRole('img', { name: 'Google' }));
    const shell = img.parentElement;

    expect(shell).not.toBeNull();
    expect(shell?.tagName).toBe('SPAN');
    expect(shell?.className).toContain('reader-avatar');
    expect(shell?.className).toContain('avatar-tone-2');
    expect(img.className).toBe('');
  });
});
