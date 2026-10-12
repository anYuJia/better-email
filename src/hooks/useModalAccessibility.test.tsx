import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import useModalAccessibility from './useModalAccessibility';

afterEach(cleanup);

function Harness() {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useModalAccessibility({ dialogRef, backdropRef });
  return <div ref={backdropRef}>
    <div role="dialog" aria-modal="true" ref={dialogRef} tabIndex={-1}>
      <button type="button" tabIndex={-1}>非活动标签</button>
      <div style={{ display: 'none' }}><button type="button">隐藏控件</button></div>
      <button type="button">第一个</button>
      <button type="button">最后一个</button>
      <div hidden><button type="button">隐藏末尾</button></div>
    </div>
  </div>;
}

describe('modal keyboard focus', () => {
  it('skips inactive tabs and controls inside hidden ancestors when trapping focus', () => {
    render(<Harness />);
    const first = screen.getByRole('button', { name: '第一个' });
    const last = screen.getByRole('button', { name: '最后一个' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });
});
