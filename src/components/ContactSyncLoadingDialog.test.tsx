import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ContactSyncLoadingDialog from './ContactSyncLoadingDialog';

afterEach(cleanup);

describe('ContactSyncLoadingDialog', () => {
  it('uses the same loading copy for an active contact scan', () => {
    render(<ContactSyncLoadingDialog open />);

    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('正在同步最近联系人')).not.toBeNull();
    expect(screen.getByText('正在从所有邮件中扫描联系人，保存姓名、邮箱和别名')).not.toBeNull();
  });

  it('does not render while scanning is inactive', () => {
    render(<ContactSyncLoadingDialog open={false} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
