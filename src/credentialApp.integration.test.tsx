import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { invoke } from './tauriBridge';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('opens the account whose saved credential is missing', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  await invoke('delete_account_secret', { accountEmail: 'design@better-email.local' });
  render(<App requestedSettingsAccountScope="all" />);
  fireEvent.click(await screen.findByRole('button', { name: '修复登录' }, { timeout: 5000 }));
  await waitFor(() => expect(document.querySelector('.settings-credential-panel')?.textContent).toContain('design@better-email.local'));
  await act(async () => { await Promise.resolve(); });
  expect(document.querySelector('.settings-credential-panel')?.textContent).toContain('design@better-email.local');
}, 15_000);
