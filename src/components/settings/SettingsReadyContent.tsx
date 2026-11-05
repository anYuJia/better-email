import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SettingsSearchEntry } from './settingsNavigation';

type ReadyContentProps = { children: ReactNode; searchTarget?: SettingsSearchEntry | null };

function LoadingContent() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 120);
    return () => window.clearTimeout(timer);
  }, []);
  return <div className="settings-page-loading" aria-busy="true" data-settings-loading="true">
    {visible && <span role="status">正在加载设置内容…</span>}
  </div>;
}

function ReadyContent({ children, searchTarget }: ReadyContentProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!searchTarget) return undefined;
    const content = ref.current;
    const page = content?.closest<HTMLElement>('[data-settings-page]');
    if (!page || page.dataset.settingsPage !== searchTarget.section) return undefined;
    const target = searchTarget.target
      ? content?.querySelector<HTMLElement>(`[data-settings-section="${searchTarget.target}"]`)
      : page.querySelector<HTMLElement>('.settings-page-header');
    if (!target) return undefined;
    const disclosures = [
      ...(target instanceof HTMLDetailsElement ? [target] : []),
      ...target.querySelectorAll<HTMLDetailsElement>('details'),
    ];
    for (let ancestor = target.parentElement; ancestor && ancestor !== page; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement) disclosures.push(ancestor);
    }
    disclosures.forEach((details) => { details.open = true; });
    const previousTabIndex = target.getAttribute('tabindex');
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    target.classList.remove('settings-search-hit');
    void target.offsetWidth;
    target.classList.add('settings-search-hit');
    const timer = window.setTimeout(() => target.classList.remove('settings-search-hit'), 650);
    return () => {
      window.clearTimeout(timer);
      target.classList.remove('settings-search-hit');
      if (previousTabIndex === null) target.removeAttribute('tabindex');
      else target.setAttribute('tabindex', previousTabIndex);
    };
  }, [searchTarget]);
  useLayoutEffect(() => {
    const element = ref.current;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!element || preference?.matches || !element.animate) return undefined;
    const tokens = getComputedStyle(document.documentElement);
    // The title/navigation are already usable. Only ready content settles;
    // opacity avoids containing blocks for fixed descendant dialogs/menus.
    const animation = element.animate([{ opacity: 0.94 }, { opacity: 1 }], {
      duration: Number.parseFloat(tokens.getPropertyValue('--ui-motion-normal')) || 180,
      easing: tokens.getPropertyValue('--ui-ease-standard').trim() || 'cubic-bezier(.2,0,0,1)',
    });
    const cancel = () => animation.cancel();
    const preferenceChanged = () => { if (preference?.matches) cancel(); };
    preference?.addEventListener?.('change', preferenceChanged);
    return () => { cancel(); preference?.removeEventListener?.('change', preferenceChanged); };
  }, []);
  return <div ref={ref} className="settings-ready-content" data-settings-content-ready="true">{children}</div>;
}

/** Put this boundary below the persistent page heading, and key it by section.
 * Suspended children cannot consume their reveal before their DOM commits. */
export default function SettingsReadyContent({ children, searchTarget }: ReadyContentProps) {
  return <Suspense fallback={<LoadingContent />}><ReadyContent searchTarget={searchTarget}>{children}</ReadyContent></Suspense>;
}
