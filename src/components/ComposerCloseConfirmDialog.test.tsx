import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComposerCloseConfirmDialog from './ComposerCloseConfirmDialog';
import useModalAccessibility from '../hooks/useModalAccessibility';

afterEach(cleanup);

type HarnessProps = {
  onClose?: () => void;
  onDiscard?: () => void;
  onSaveDraft?: () => Promise<void>;
  closeOnDiscard?: boolean;
};

function Harness({
  onClose = () => undefined,
  onDiscard = () => undefined,
  onSaveDraft = async () => undefined,
  closeOnDiscard = false,
}: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button id="close-confirm-trigger" type="button" onClick={() => setOpen(true)}>打开关闭确认</button>
      <button id="background-action" type="button">背景操作</button>
      {open && (
        <ComposerCloseConfirmDialog
          setOpen={setOpen}
          onClose={() => {
            setOpen(false);
            onClose();
          }}
          onDiscard={() => {
            if (closeOnDiscard) {
              document.getElementById('background-action')?.removeAttribute('inert');
              setOpen(false);
            }
            onDiscard();
          }}
          onSaveDraft={onSaveDraft}
        />
      )}
    </div>
  );
}

function openDialog() {
  const trigger = screen.getByRole('button', { name: '打开关闭确认' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

function NestedModalHarness() {
  const [open, setOpen] = useState(true);
  const outerBackdropRef = useRef<HTMLDivElement>(null);
  const outerDialogRef = useRef<HTMLElement>(null);
  useModalAccessibility({
    dialogRef: outerDialogRef,
    backdropRef: outerBackdropRef,
  });
  return (
    <div>
      <div ref={outerBackdropRef} className="composer-backdrop">
        <section ref={outerDialogRef} role="dialog" aria-modal="true" aria-label="写信窗口">
          <button type="button">关闭写信窗口</button>
        </section>
      </div>
      {open && (
        <ComposerCloseConfirmDialog
          setOpen={setOpen}
          onClose={() => setOpen(false)}
          onDiscard={() => setOpen(false)}
          onSaveDraft={async () => undefined}
        />
      )}
    </div>
  );
}

describe('ComposerCloseConfirmDialog modal accessibility', () => {
  it('distinguishes the recovery snapshot from a saved draft', () => {
    render(<Harness />);
    openDialog();

    expect(screen.getByText('当前内容还未保存到草稿箱')).not.toBeNull();
    expect(screen.getByText('保存这封邮件？')).not.toBeNull();
    expect(screen.getByText(/恢复点仅用于意外关闭/)).not.toBeNull();
    expect(screen.getByRole('button', { name: '舍弃并关闭' })).not.toBeNull();
  });

  it('focuses the safe action, isolates the background, and restores focus on close', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    const trigger = openDialog();
    const continueButton = screen.getByRole('button', { name: '继续编辑' });
    const backgroundButton = document.getElementById('background-action') as HTMLButtonElement;

    expect(document.activeElement).toBe(continueButton);
    expect(trigger.hasAttribute('inert')).toBe(true);
    expect(trigger.getAttribute('aria-hidden')).toBe('true');
    expect(backgroundButton.hasAttribute('inert')).toBe(true);

    fireEvent.click(continueButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.hasAttribute('inert')).toBe(false);
    expect(trigger.hasAttribute('aria-hidden')).toBe(false);
  });

  it('cycles Tab in both directions and brings escaped focus back inside', () => {
    render(<Harness />);
    openDialog();

    const closeButton = screen.getByRole('button', { name: '关闭确认' });
    const saveButton = screen.getByRole('button', { name: '保存并关闭' });
    const backgroundButton = document.getElementById('background-action') as HTMLButtonElement;

    saveButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(saveButton);

    backgroundButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);
  });

  it('keeps the top confirmation interactive above the composer modal', () => {
    const { container } = render(<NestedModalHarness />);
    const confirmationBackdrop = container.querySelector<HTMLElement>('.dialog-backdrop')!;
    const composerBackdrop = container.querySelector<HTMLElement>('.composer-backdrop')!;
    const closeButton = screen.getByRole('button', { name: '关闭确认' });
    const saveButton = screen.getByRole('button', { name: '保存并关闭' });

    expect(confirmationBackdrop.hasAttribute('inert')).toBe(false);
    expect(confirmationBackdrop.getAttribute('aria-hidden')).toBeNull();
    expect(composerBackdrop.hasAttribute('inert')).toBe(true);
    expect(composerBackdrop.getAttribute('aria-hidden')).toBe('true');

    saveButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);
  });

  it('closes on Escape and restores focus to the trigger', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = openDialog();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not resurrect inert owned by an underlying modal that closes in the same commit', () => {
    render(<Harness closeOnDiscard />);
    const backgroundButton = screen.getByRole('button', { name: '背景操作' });
    backgroundButton.setAttribute('inert', '');
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: '舍弃并关闭' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(backgroundButton.hasAttribute('inert')).toBe(false);
    expect(backgroundButton.hasAttribute('aria-hidden')).toBe(false);
  });

  it('announces save failures and enables retry', async () => {
    const onSaveDraft = vi.fn().mockRejectedValue(new Error('磁盘暂时不可写'));
    render(<Harness onSaveDraft={onSaveDraft} />);
    openDialog();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存并关闭' }));
    });

    expect(screen.getByRole('alert').textContent).toBe('保存草稿失败：磁盘暂时不可写');
    expect(screen.getByRole('button', { name: '保存并关闭' }).hasAttribute('disabled')).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存并关闭' }));
    });
    expect(onSaveDraft).toHaveBeenCalledTimes(2);
  });
});
