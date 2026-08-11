import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyAccountCreateForm } from '../../../app/appConfig';
import AddAccountDialog from './AddAccountDialog';

describe('AddAccountDialog', () => {
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
});
