import { createContext, Suspense, useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { X } from 'lucide-react';
import useComposerGeometry from '../../hooks/useComposerGeometry';
import useModalAccessibility from '../../hooks/useModalAccessibility';
import './composer-frame.css';
import './composer-loading.css';

type LoadingHandoff = { shown: boolean; opener: HTMLElement | null };
export const ComposerLoadingContext = createContext<MutableRefObject<LoadingHandoff> | null>(null);

function ComposerLoadingSurface({ onClose, handoff, mobile }: { onClose: () => void; handoff: MutableRefObject<LoadingHandoff>; mobile: boolean }) {
  const panel = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const geometry = useComposerGeometry(panel, !mobile, true);
  useLayoutEffect(() => {
    if (!handoff.current.shown) {
      handoff.current = { shown: true, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    }

  }, [handoff]);
  useModalAccessibility({ open: mobile, dialogRef: panel, backdropRef: layer, onEscape: onClose });
  const close = () => {
    const opener = handoff.current.opener;
    if (!mobile && layer.current?.contains(document.activeElement) && opener?.isConnected && !opener.closest('[inert]')) {
      opener.focus({ preventScroll: true });
    }
    onClose();
  };
  return <div ref={layer} className={`composer-loading-layer${mobile ? ' is-mobile' : ''}`} role="dialog" aria-label="写信窗口" aria-modal={mobile || undefined}>
    <section ref={panel} className="composer-frame composer-loading" aria-busy="true" style={geometry.style}
      onPointerMove={geometry.move} onPointerUp={geometry.end} onPointerCancel={geometry.end}>
      <header onPointerDown={geometry.beginDrag}>
        <strong>新邮件</strong>
        <button type="button" aria-label="关闭写信窗口" onClick={close}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
      </header>
      <div className="composer-loading-fields" aria-hidden="true">
        {['发件人', '收件人', '主题'].map(label => <div key={label}><span>{label}</span><i /></div>)}
      </div>
      <div className="composer-loading-status" role="status"><span className="deferred-spinner" aria-hidden="true" />正在准备写信…</div>
      <div className="composer-loading-body" aria-hidden="true" />
      <footer aria-hidden="true" />
    </section>
  </div>;
}

export default function ComposerLoadingBoundary({ open, children, mobile = false }: { open: false | (() => void); children: ReactNode; mobile?: boolean }) {
  const handoff = useRef<LoadingHandoff>({ shown: false, opener: null });
  useLayoutEffect(() => {
    if (!open) handoff.current = { shown: false, opener: null };
  }, [open]);
  return <ComposerLoadingContext.Provider value={handoff}>
    <Suspense fallback={open ? <ComposerLoadingSurface onClose={open} handoff={handoff} mobile={mobile} /> : null}>{children}</Suspense>
  </ComposerLoadingContext.Provider>;
}
