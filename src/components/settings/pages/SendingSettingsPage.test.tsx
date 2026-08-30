import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SendingSettingsPage from './SendingSettingsPage';

describe('SendingSettingsPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows undo send as one setting without a duplicate sending heading', () => {
    const onCrossAccountRiskWarningChange = vi.fn();
    render(
      <SendingSettingsPage
        sendUndoDelaySeconds={10}
        crossAccountRiskWarning
        accountPreferenceBusy={false}
        onSendUndoDelayChange={vi.fn()}
        onCrossAccountRiskWarningChange={onCrossAccountRiskWarningChange}
      />,
    );

    expect(screen.queryByText('发送')).toBeNull();
    expect(screen.getByText('撤销发送')).not.toBeNull();
    expect(screen.getByRole('combobox', { name: '撤销发送延迟' })).not.toBeNull();
    const globalWarning = screen.getByRole('checkbox', { name: /跨邮箱发送提醒/ });
    expect((globalWarning as HTMLInputElement).checked).toBe(true);
    fireEvent.click(globalWarning);
    expect(onCrossAccountRiskWarningChange).toHaveBeenCalledWith(false);
  });
});
