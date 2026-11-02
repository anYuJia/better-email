import { useRef, useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useModalAccessibility from './useModalAccessibility';

afterEach(cleanup);

function Modal({ label, onEscape, children }: { label: string; onEscape?: () => void; children: ReactNode }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalAccessibility({ dialogRef, backdropRef, onEscape });
  return <div ref={backdropRef}><section ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</section></div>;
}

describe('shared modal keyboard ownership', () => {
  it('lets only a nested top dialog handle Escape', () => {
    const outerEscape = vi.fn();
    const innerEscape = vi.fn();
    function Nested() {
      const [innerOpen, setInnerOpen] = useState(false);
      return <Modal label="outer" onEscape={outerEscape}>
        <button onClick={() => setInnerOpen(true)}>打开内层</button>
        {innerOpen && <Modal label="inner" onEscape={() => { innerEscape(); setInnerOpen(false); }}><button>内层操作</button></Modal>}
      </Modal>;
    }
    render(<Nested />);
    fireEvent.click(screen.getByRole('button', { name: '打开内层' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerEscape).toHaveBeenCalledTimes(1);
    expect(outerEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开内层' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outerEscape).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss a dialog when Escape cancels an IME composition', () => {
    const onEscape = vi.fn();
    render(<Modal label="输入" onEscape={onEscape}><input aria-label="名称" /></Modal>);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape', isComposing: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape', keyCode: 229 });
    expect(onEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('wraps past controls in hidden branches and disabled fieldsets', () => {
    render(<Modal label="设置">
      <div hidden><button>隐藏首项</button></div>
      <button>首项</button>
      <button>末项</button>
      <div style={{ display: 'none' }}><button>折叠项</button></div>
      <fieldset disabled><button>禁用项</button></fieldset>
      <button tabIndex={-2}>程序焦点项</button>
    </Modal>);
    const first = screen.getByRole('button', { name: '首项' });
    const last = screen.getByRole('button', { name: '末项' });
    expect(document.activeElement).toBe(first);
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
