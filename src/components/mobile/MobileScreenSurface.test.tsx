import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileScreenSurface from './MobileScreenSurface';
import { useRef } from 'react';
import useModalAccessibility from '../../hooks/useModalAccessibility';

function Drawer({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalAccessibility({ open: active, dialogRef: ref, backdropRef: ref });
  return <div ref={ref} role="dialog" aria-modal={active || undefined}><button>关闭抽屉</button></div>;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('MobileScreenSurface', () => {
  it('hands focus to Settings after the outgoing drawer restores its old trigger', () => {
    const surfaces = (screen: string) => <>
      <MobileScreenSurface kind="mail" active={screen !== 'settings'} persistent><button>邮箱导航</button></MobileScreenSurface>
      <MobileScreenSurface kind="mailbox" active={screen === 'mailbox'}><Drawer active={screen === 'mailbox'} /></MobileScreenSurface>
      <MobileScreenSurface kind="settings" active={screen === 'settings'}><button>返回邮箱</button></MobileScreenSurface>
    </>;
    const view = render(surfaces('mail'));
    screen.getByRole('button', { name: '邮箱导航' }).focus();
    view.rerender(surfaces('mailbox'));
    expect(document.activeElement?.textContent).toBe('关闭抽屉');
    view.rerender(surfaces('settings'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '返回邮箱' }));
    expect(document.activeElement?.closest('[inert]')).toBeNull();
  });
  it('keeps inbox scroll and focus on return while isolating the outgoing screen', () => {
    const view = render(<MobileScreenSurface kind="mail" active persistent><button>邮件</button></MobileScreenSurface>);
    const button = screen.getByRole('button');
    const surface = button.parentElement!;
    surface.scrollTop = 360;
    button.focus();
    view.rerender(<MobileScreenSurface kind="mail" active={false} persistent><button>邮件</button></MobileScreenSurface>);
    expect(surface.hasAttribute('inert')).toBe(true);
    expect(surface.getAttribute('aria-hidden')).toBe('true');
    expect(surface.hidden).toBe(false);
    act(() => vi.advanceTimersByTime(180));
    expect(surface.hidden).toBe(true);
    view.rerender(<MobileScreenSurface kind="mail" active persistent><button>邮件</button></MobileScreenSurface>);
    expect(screen.getByRole('button')).toBe(button);
    expect(surface.scrollTop).toBe(360);
    expect(surface.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('cancels pending removal when navigation reverses rapidly', () => {
    const view = render(<MobileScreenSurface kind="reader" active><button>返回</button></MobileScreenSurface>);
    view.rerender(<MobileScreenSurface kind="reader" active={false}><button>返回</button></MobileScreenSurface>);
    act(() => vi.advanceTimersByTime(80));
    view.rerender(<MobileScreenSurface kind="reader" active><button>返回</button></MobileScreenSurface>);
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByRole('button', { name: '返回' })).toBeDefined();
    view.rerender(<MobileScreenSurface kind="reader" active={false}><button>返回</button></MobileScreenSurface>);
    act(() => vi.advanceTimersByTime(180));
    expect(view.container.children.length).toBe(0);
  });

  it('removes an outgoing screen immediately when reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const view = render(<MobileScreenSurface kind="reader" active><button>返回</button></MobileScreenSurface>);
    view.rerender(<MobileScreenSurface kind="reader" active={false}><button>返回</button></MobileScreenSurface>);
    act(() => vi.advanceTimersByTime(0));
    expect(view.container.children.length).toBe(0);
    vi.unstubAllGlobals();
  });

  it('finishes an exiting drawer when reduced motion is enabled mid-transition', () => {
    const listeners = new Set<() => void>();
    const preference = {
      matches: false,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => preference));
    const view = render(<MobileScreenSurface kind="mailbox" active><button>邮箱</button></MobileScreenSurface>);
    view.rerender(<MobileScreenSurface kind="mailbox" active={false}><button>邮箱</button></MobileScreenSurface>);
    act(() => vi.advanceTimersByTime(60));
    expect(view.container.children.length).toBe(1);
    act(() => {
      preference.matches = true;
      listeners.forEach(listener => listener());
    });
    expect(view.container.children.length).toBe(0);
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });
});
