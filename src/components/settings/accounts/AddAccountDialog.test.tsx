import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAccountCreateForm } from '../../../app/appConfig';
import SettingsFrame from '../SettingsFrame';
import AddAccountDialog from './AddAccountDialog';

const addDialogProps = {
  form: emptyAccountCreateForm,
  secret: 'authorization-code',
  secretVisible: false,
  manualConfigOpen: false,
  error: '',
  submitting: false,
  canSubmit: true,
  requiresSecret: true,
  secretLabel: '授权码',
  secretPlaceholder: '输入授权码',
  matchedProviderLabel: '自定义邮箱',
  serverReady: true,
  onSubmit: vi.fn(),
  onSecretChange: vi.fn(),
  onSecretVisibleChange: vi.fn(),
  onManualConfigOpenChange: vi.fn(),
  onEmailChange: vi.fn(),
  onFormChange: vi.fn(),
  onProtocolChange: vi.fn(),
  onApplyPreset: vi.fn(),
};

describe('AddAccountDialog', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return this.parentElement;
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('stores the historical attachment information choice in the account form', () => {
    const onFormChange = vi.fn();
    render(
      <AddAccountDialog
        form={emptyAccountCreateForm}
        secret="authorization-code"
        secretVisible={false}
        manualConfigOpen={false}
        error=""
        submitting={false}
        canSubmit
        requiresSecret
        secretLabel="授权码"
        secretPlaceholder="输入授权码"
        matchedProviderLabel="自定义邮箱"
        serverReady
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onSecretChange={vi.fn()}
        onSecretVisibleChange={vi.fn()}
        onManualConfigOpenChange={vi.fn()}
        onEmailChange={vi.fn()}
        onFormChange={onFormChange}
        onProtocolChange={vi.fn()}
        onApplyPreset={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: /读取历史邮件附件信息/,
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    expect(onFormChange).toHaveBeenCalledWith(expect.objectContaining({
      fetch_history_attachments: true,
    }));
  });

  it('traps focus inside the nested dialog and restores the opener on Escape', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = '添加账号入口';
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <AddAccountDialog
        form={emptyAccountCreateForm}
        secret="authorization-code"
        secretVisible={false}
        manualConfigOpen={false}
        error=""
        submitting={false}
        canSubmit
        requiresSecret
        secretLabel="授权码"
        secretPlaceholder="输入授权码"
        matchedProviderLabel="自定义邮箱"
        serverReady
        onClose={onClose}
        onSubmit={vi.fn()}
        onSecretChange={vi.fn()}
        onSecretVisibleChange={vi.fn()}
        onManualConfigOpenChange={vi.fn()}
        onEmailChange={vi.fn()}
        onFormChange={vi.fn()}
        onProtocolChange={vi.fn()}
        onApplyPreset={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '添加邮箱' });
    const emailInput = screen.getByRole('textbox', { name: '邮箱地址' });
    const first = screen.getByRole('button', { name: '关闭' });
    const last = screen.getByRole('button', { name: '添加' });
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(emailInput, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    document.body.removeChild(opener);
  });

  it('lets one Escape close only Add Account inside Settings and restores its opener', async () => {
    function NestedDialogHarness() {
      const [settingsOpen, setSettingsOpen] = useState(true);
      const [addOpen, setAddOpen] = useState(false);

      return settingsOpen ? (
        <SettingsFrame
          title="设置"
          subtitle="work@example.com"
          activeSection="accounts"
          onNavigate={vi.fn()}
          onTestConnection={vi.fn()}
          onSave={vi.fn()}
          onClose={() => setSettingsOpen(false)}
        >
          <button type="button" onClick={() => setAddOpen(true)}>
            添加账号
          </button>
          {addOpen && (
            <AddAccountDialog
              {...addDialogProps}
              onClose={() => setAddOpen(false)}
            />
          )}
        </SettingsFrame>
      ) : null;
    }

    render(<NestedDialogHarness />);
    const opener = screen.getByRole('button', { name: '添加账号' });
    opener.focus();
    fireEvent.click(opener);

    const emailInput = screen.getByRole('textbox', { name: '邮箱地址' });
    await waitFor(() => expect(document.activeElement).toBe(emailInput));
    const lastDialogAction = screen.getByRole('button', { name: '添加' });
    lastDialogAction.focus();
    expect(document.activeElement).toBe(lastDialogAction);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: '添加邮箱' })).toBeNull();
    expect(screen.getByRole('region', { name: '设置' })).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
