import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SendingSettingsPage from './SendingSettingsPage';

describe('SendingSettingsPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows undo send as one setting without a duplicate sending heading', () => {
    render(
      <SendingSettingsPage
        sendUndoDelaySeconds={10}
        onSendUndoDelayChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('发送')).toBeNull();
    expect(screen.getByText('撤销发送')).not.toBeNull();
    expect(screen.getByRole('combobox', { name: '撤销发送延迟' })).not.toBeNull();
  });
});
